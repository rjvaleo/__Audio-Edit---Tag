# -*- coding: utf-8 -*-
"""Decimated waveform peaks, 60 buckets, quantised to one base64 char each.
Read-only. Resumable. Output: /tmp/waveforms.tsv  (key \t peaks)"""
import csv,os,struct,array,sys,time,json
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
BASE=APP                                        # data + html live beside tools
WORK=_os.path.join(APP,"work"); _os.makedirs(WORK,exist_ok=True)
def W(n): return _os.path.join(WORK,n)
OUT=W('waveforms.tsv')
ST=W('wave_state.json')



B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
NB=60
NATBE = struct.pack('=h',1)==struct.pack('>h',1)
def peaks(p,fmt,ch,bits):
    sz=os.path.getsize(p); hdr=1024
    body=sz-hdr
    if body<4096: hdr=0; body=sz
    if body<=0: return None
    step=max(64,body//NB); out=[]; be=fmt.startswith('AIF')
    try:
        with open(p,'rb') as fh:
            for i in range(NB):
                fh.seek(hdr+i*step); d=fh.read(min(1024,step))
                if len(d)<8: out.append(0); continue
                if bits==32 and fmt=='WAV-float32':
                    a=array.array('f'); a.frombytes(d[:len(d)//4*4])
                    v=min(1.0,max((abs(x) for x in a),default=0))
                else:
                    a=array.array('h'); a.frombytes(d[:len(d)//2*2])
                    if be!=NATBE: a.byteswap()
                    v=max((abs(x) for x in a),default=0)/32768.0
                out.append(v)
    except Exception: return None
    if not out or max(out)<=0: return None
    m=max(out)
    return "".join(B64[min(63,int(63*(v/m)**0.6))] for v in out)   # gamma for visibility
def main():
    budget=int(sys.argv[1]) if len(sys.argv)>1 else 32
    done=set()
    if os.path.exists(OUT):
        for line in open(OUT,encoding='utf-8'):
            done.add(line.split('\t')[0])
    rows=[r for r in csv.DictReader(open(W('ingest2_files.tsv'),encoding='utf-8'),delimiter='\t')
          if r['format'] in ('AIFF','AIFC','WAV','WAV-float32','WAV-ext') and float(r['duration_s'] or 0)>0]
    fh=open(OUT,'a',encoding='utf-8')
    end=time.time()+budget; n=0; skip=0
    for r in rows:
        key=r['root_folder']+'/'+r['rel_path']
        if key in done: continue
        if time.time()>end: break
        p=os.path.join(ING,r['root_folder'],r['rel_path'])
        try: pk=peaks(p,r['format'],int(r['channels'] or 1),int(r['bits'] or 16))
        except Exception: pk=None
        fh.write("%s\t%s\n"%(key.replace('\t',' '),pk or ''))
        n+=1
        if not pk: skip+=1
    fh.close()
    print("this pass: %d (%d no-peaks) | total %d / %d"%(n,skip,len(done)+n,len(rows)))
if __name__=="__main__": main()
