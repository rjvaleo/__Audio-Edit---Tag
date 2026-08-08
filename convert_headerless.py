# -*- coding: utf-8 -*-
"""
Give headerless PCM files a real AIFF header. No transcoding - the audio bytes are
copied verbatim (byte-swapped only if the source is little-endian), so this is a
fast disk copy, not an encode.

Specs are INFERRED, then checked:
  1. candidate specs come from headered files in the same folder
  2. candidates that don't divide evenly into the file length are discarded
  3. the survivor with the smoothest waveform wins (noise = wrong interpretation)

  python convert_headerless.py --analyze    # infer + report, writes nothing
  python convert_headerless.py --validate   # self-test on known files
  python convert_headerless.py --convert    # write <name>.aiff next to each original
"""
import os,sys,csv,struct,array,json,time
from collections import Counter,defaultdict
import os as _os
HERE=_os.path.dirname(_os.path.abspath(__file__))
APP=_os.path.dirname(HERE)                      # the "Audio Edit & Tag" folder
def _find_ingest(start):
    d=start
    for _ in range(5):
        c=_os.path.join(d,"INGEST")
        if _os.path.isdir(c): return c
        p=_os.path.dirname(d)
        if p==d: break
        d=p
    return _os.path.join(_os.path.dirname(APP),"INGEST")
ING=_find_ingest(APP)
LIB=_os.path.dirname(ING)                       # the Audio Library root
BASE=APP                                        # data + html live beside _tools
WORK=_os.path.join(APP,"_work"); _os.makedirs(WORK,exist_ok=True)
def W(n): return _os.path.join(WORK,n)
IDX=_os.path.join(APP,'_AUDIO-INDEX.tsv')




NATBE = struct.pack('=h',1)==struct.pack('>h',1)
DEFAULTS=[(44100,16,2),(44100,16,1),(48000,16,2),(48000,16,1),(44100,24,2),(44100,24,1),(22050,16,1)]

def smoothness(buf,bits,ch,be):
    """mean |sample delta| / rms, on one channel. low = plausible audio."""
    if bits==16:
        a=array.array('h'); a.frombytes(buf[:len(buf)//2*2])
        if be!=NATBE: a.byteswap()
    elif bits==24:
        n=len(buf)//3; a=array.array('i',[0])*0; a=array.array('i')
        for i in range(min(n,40000)):
            c=buf[i*3:i*3+3]
            v=(c[0]<<16|c[1]<<8|c[2]) if be else (c[2]<<16|c[1]<<8|c[0])
            if v&0x800000: v-=0x1000000
            a.append(v)
    elif bits==32:
        a=array.array('i'); a.frombytes(buf[:len(buf)//4*4])
        if be!=NATBE: a.byteswap()
    else: return None
    if ch==2: a=a[0::2]
    if len(a)<200: return None
    rms=(sum(v*v for v in a)/len(a))**0.5
    if rms<1: return None
    return sum(abs(a[i+1]-a[i]) for i in range(len(a)-1))/(len(a)-1)/rms

def sample_bytes(path,sz,want=48000):
    with open(path,'rb') as fh:
        fh.seek(sz//3 if sz>3*want else 0)
        return fh.read(want)

def infer(path,sz,ranked):
    """Channel count / bit depth / rate come from the folder's headered files,
    filtered to those that divide the byte length evenly. Smoothness decides ONLY
    endianness - it is mathematically incapable of telling mono from dual-mono
    stereo (both give a 0.5 delta ratio), so it is never asked to."""
    buf=None
    for (sr,bits,ch),w in ranked:
        align=bits//8*ch
        if align<=0 or sz%align: continue
        if buf is None: buf=sample_bytes(path,sz)
        sBE=smoothness(buf,bits,ch,True); sLE=smoothness(buf,bits,ch,False)
        if sBE is None and sLE is None: continue
        if sBE is None: be,sc=False,sLE
        elif sLE is None: be,sc=True,sBE
        else:
            # ambiguous margin -> default big-endian: these are Mac-origin data forks
            lo=min(sBE,sLE); margin=abs(sBE-sLE)/lo if lo>0 else 9
            if margin<0.15: be,sc=True,sBE
            else: be,sc=((True,sBE) if sBE<=sLE else (False,sLE))
        return (sr,bits,ch,be,sc,"align%%%d weight=%d"%(align,w))
    return None

def load_candidates():
    sib=defaultdict(Counter); raw=[]
    for r in csv.DictReader(open(IDX,encoding='utf-8'),delimiter='\t'):
        if r['format'] in ('AIFF','WAV','WAV-float32','AIFC:sowt') and r['samplerate'] not in ('','0'):
            try: sib[r['root_folder']][(int(r['samplerate']),int(r['bits']),int(r['channels']))]+=1
            except: pass
        if r['format']=='RAW-PCM': raw.append(r)
    return sib,raw

def rank(counter,drop=None):
    c=Counter(counter)
    if drop and c.get(drop): c[drop]-=1
    out=[(k,v) for k,v in c.most_common() if v>0 and k[1] in (16,24,32) and k[2] in (1,2)]
    seen={k for k,_ in out}
    for d in DEFAULTS:
        if d not in seen: out.append((d,0))
    return out

def aiff_header(nbytes,ch,bits,sr):
    def sr80(v):
        e=0; m=float(v)
        while m<(1<<63): m*=2; e+=1
        return struct.pack('>HQ',16383+63-e,int(m))
    fr=nbytes//(ch*bits//8)
    comm=struct.pack('>hIh',ch,fr,bits)+sr80(sr); ssnd=struct.pack('>II',0,0)
    body=b'AIFF'+b'COMM'+struct.pack('>I',len(comm))+comm+b'SSND'+struct.pack('>I',len(ssnd)+nbytes)+ssnd
    return b'FORM'+struct.pack('>I',len(body)+nbytes)+body

def swap(buf,bits):
    a=bytearray(buf)
    if bits==16: a[0::2],a[1::2]=a[1::2],a[0::2]
    elif bits==24: a[0::3],a[2::3]=a[2::3],a[0::3]
    elif bits==32: a[0::4],a[1::4],a[2::4],a[3::4]=a[3::4],a[2::4],a[1::4],a[0::4]
    return bytes(a)

def payload_of(path,fmt):
    """exact PCM payload of a headered file - the true frame-aligned bytes"""
    d=open(path,'rb').read()
    if fmt=='AIFF':
        o=12
        while o+8<=len(d):
            cid=d[o:o+4]; csz=struct.unpack('>I',d[o+4:o+8])[0]
            if cid==b'SSND':
                off=struct.unpack('>I',d[o+8:o+12])[0]
                return d[o+16+off:o+8+csz]
            if csz<=0: break
            o+=8+csz+(csz&1)
    else:
        o=12
        while o+8<=len(d):
            cid=d[o:o+4]; csz=struct.unpack('<I',d[o+4:o+8])[0]
            if cid==b'data': return d[o+8:o+8+csz]
            if csz<=0: break
            o+=8+csz+(csz&1)
    return None

def validate(n=150):
    sib,_=load_candidates()
    rows=[r for r in csv.DictReader(open(IDX,encoding='utf-8'),delimiter='\t')
          if r['format'] in ('AIFF','WAV') and r['samplerate'] not in ('','0')
          and 20000<int(r['bytes'])<4000000]
    import random; random.seed(7); random.shuffle(rows)
    hit=miss=skip=0; bad=[]; endok=0
    for r in rows[:n]:
        p=os.path.join(ING,r['root_folder'],r['rel_path'])
        if not os.path.isfile(p): continue
        truth=(int(r['samplerate']),int(r['bits']),int(r['channels']))
        try: data=payload_of(p,r['format'])
        except Exception: data=None
        if not data or len(data)<20000: continue
        tmp=W('_hdrless.bin'); open(tmp,'wb').write(data)
        got=infer(tmp,len(data),rank(sib[r['root_folder']],truth))
        if not got: skip+=1; continue
        if (got[0],got[1],got[2])==truth:
            hit+=1
            if got[3]==(r['format']=='AIFF'): endok+=1
        else:
            miss+=1
            if len(bad)<6: bad.append((r['filename'][:26],truth,got[:4]))
    print("VALIDATION on %d known files (true payload extracted):"%(hit+miss+skip))
    print("  specs recovered correctly : %d"%hit)
    print("  wrong                     : %d"%miss)
    print("  no candidate fit          : %d"%skip)
    if hit+miss: print("  ACCURACY                  : %.0f%%"%(100*hit/(hit+miss)))
    if hit: print("  endianness correct        : %d/%d"%(endok,hit))
    for b in bad: print("   miss: %-26s truth=%s got=%s"%b)

def main():
    mode='--analyze'
    for a in sys.argv[1:]:
        if a.startswith('--'): mode=a
    if mode=='--validate': return validate()
    sib,raw=load_candidates()
    conv=(mode=='--convert')
    out=[]; done=0; skipped=0; t0=time.time(); wrote=0
    for r in raw:
        p=os.path.join(ING,r['root_folder'],r['rel_path'])
        if not os.path.isfile(p): continue
        sz=os.path.getsize(p)
        if sz<128: skipped+=1; continue
        cands=rank(sib[r['root_folder']])
        got=infer(p,sz,cands)
        if not got: skipped+=1; out.append([r['root_folder'],r['rel_path'],'','','','','SKIPPED no fit']); continue
        sr,bits,ch,be,score,why=got
        src='folder siblings' if sib[r['root_folder']] else 'defaults'
        conf='high' if (sib[r['root_folder']] and score<0.25) else ('med' if score<0.5 else 'low')
        out.append([r['root_folder'],r['rel_path'],sr,bits,ch,'BE' if be else 'LE',
                    '%s score=%.3f from=%s'%(conf,score,src)])
        if conv:
            tgt=p+'.aiff'
            if os.path.exists(tgt): continue
            n=(sz//(ch*bits//8))*(ch*bits//8)
            with open(p,'rb') as fh: body=fh.read(n)
            if not be: body=swap(body,bits)
            with open(tgt,'wb') as fh: fh.write(aiff_header(len(body),ch,bits,sr)); fh.write(body)
            wrote+=1
        done+=1
    with open(os.path.join(BASE,'_HEADERLESS-PLAN.tsv'),'w',encoding='utf-8',newline='') as fh:
        w=csv.writer(fh,delimiter='\t')
        w.writerow(['folder','rel_path','samplerate','bits','channels','endian','confidence'])
        w.writerows(out)
    print("analysed %d | skipped %d | written %d | %.1fs"%(done,skipped,wrote,time.time()-t0))
    print("plan written to _HEADERLESS-PLAN.tsv")
    c=Counter(x[6].split()[0] for x in out)
    print("confidence:",dict(c))
if __name__=='__main__': main()
