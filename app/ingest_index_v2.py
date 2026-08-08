# -*- coding: utf-8 -*-
"""
Audio Library ingest indexer v2
See INGEST-TAXONOMY.md for the full rule documentation.
Usage:  python3 ingest_index_v2.py [seconds_budget] [--reset]
Resumable: re-run until it reports 0 remaining.
"""
import os,sys,json,struct,time,re,csv
from paths import *
import os as _os
ING=LIBRARY; LIB=LIBRARY
BASE=HERE; APP=HERE; WORK=HERE
def W(n): return D(n)
ST=D('state-ingest.json')
FILES=FILE_INDEX
FOLD=FOLDER_INDEX








# ---------------------------------------------------------------- machines
MACHINES = [
 (r'\btr[-_ ]?808\b|(^|[^0-9])808([^0-9]|$)','TR-808'),
 (r'\btr[-_ ]?909\b|(^|[^0-9])909([^0-9]|$)','TR-909'),
 (r'\btr[-_ ]?707\b|(^|[^0-9])707([^0-9]|$)','TR-707'),
 (r'\btr[-_ ]?727\b','TR-727'), (r'\btr[-_ ]?606\b','TR-606'),
 (r'\btr[-_ ]?505\b|\btr505\b','TR-505'), (r'\bcr[-_ ]?78\b','CR-78'),
 (r'\blinn?\s?drum\b|\blm[-_ ]?1\b|\blinndrum\b','LinnDrum LM-1'),
 (r'\bsp[-_ ]?12\b','E-mu SP-12'), (r'\bsp[-_ ]?1200\b','E-mu SP-1200'),
 (r'\bmpc\b','Akai MPC'), (r'\bdmx\b','Oberheim DMX'),
 (r'\bdrumulator\b','E-mu Drumulator'), (r'\bsimmons\b','Simmons'),
 (r'\bvermona\b','Vermona DRM1'), (r'\bacetone\b','Acetone Rhythm'),
 (r'\brhythm[_ ]?ace\b','Acetone Rhythm Ace'),
 (r'\brhythm[_ ]?king\b','Acetone Rhythm King'),
 (r'\brhythm[_ ]?master\b','Acetone Rhythm Master'),
 (r'\bmachinedrum\b','Elektron Machinedrum'),
 (r'\belectribe\b','Korg Electribe'), (r'\bmc[-_ ]?303\b','Roland MC-303'),
 (r'\bpercusyn\b','AJK Percusyn'), (r'\bserge\b','Serge Modular'),
 (r'\bmoog\b','Moog Modular'), (r'\bsynsonics\b','Mattel Synsonics'),
 (r'\bcheckmate\b','Keio Checkmate'), (r'\bsds\s?2000\b','Simmons SDS2000'),
 (r'\boberheim\b','Oberheim'), (r'\balesis\b','Alesis'),
 (r'\bakai\b','Akai'), (r'\bkorg\b','Korg'), (r'\bemu\b|\be-mu\b','E-mu'),
 (r'\bbattery\b','NI Battery'), (r'\babsynth\b','NI Absynth'),
 (r'\bkontakt\b','NI Kontakt'), (r'\bhalion\b','Halion'),
]
# ---------------------------------------------------------------- instruments
INSTRUMENTS = [
 (r'\b(bd|bass\s?drum|kick|kik)\b','Kick'),
 (r'\b(sd|snare|sn|snr)\b','Snare'),
 (r'\b(rim|rs|rimshot|sidestick)\b','Rim'),
 (r'\b(chh?|closed\s?hat|hh\s?cl|cl\s?hat|hatc)\b','Hat Closed'),
 (r'\b(ohh?|open\s?hat|hh\s?op|op\s?hat)\b','Hat Open'),
 (r'\b(hh|hat|hihat|hi[-_ ]?hat)\b','Hat'),
 (r'\b(cp|clap|claps|handclap)\b','Clap'),
 (r'\b(tom|lowtom|hitom|midtom|floor\s?tom)\b','Tom'),
 (r'\b(crash|crsh|cym|cymbal)\b','Crash'),
 (r'\b(ride|rd)\b','Ride'),
 (r'\b(cb|cowbell)\b','Cowbell'),
 (r'\b(clave|claves)\b','Clave'),
 (r'\b(conga|bongo|tumba)\b','Conga'),
 (r'\b(shaker|maraca|cabasa|guiro)\b','Shaker'),
 (r'\b(tamb|tambourine)\b','Tambourine'),
 (r'\b(perc|percussion)\b','Perc'),
 (r'\b(stick|click)\b','Stick'),
 (r'\b(bass|sub|808\s?bass)\b','Bass'),
 (r'\b(lead|arp|pluck|key|keys|piano|organ|rhodes)\b','Melodic'),
 (r'\b(string|strings|brass|horn|flute|violin|cello)\b','Orchestral'),
 (r'\b(vox|vocal|voice|speech|spoken|acapella|acapela)\b','Vocal'),
 (r'\b(noise|white|pink)\b','Noise'),
]
DESCRIPTORS = [r'\b(hrd|hard|med|medium|sft|soft|lite|light|loud|quiet)\b',
               r'\b(dry|wet|amb|ambient|verb|reverb|grev|gated|room|comp|compressed|eq)\b',
               r'\b(long|short|dec|decay|tight|open|closed|mute|muted|roll|flam)\b']
SONG_WORDS   = r'\b(master|mastered|final|finals|mixdown|mixed|mstr|full\s?mix|album|track\s?\d|radio\s?edit|remaster)\b'
LOOP_WORDS   = r'\b(loop|lp|groove|beat|break|bar|bars|riff)\b'
PAD_WORDS    = r'\b(pad|drone|atmos|atmosphere|ambient|amb|texture|bed|wash|swell|soundscape|field)\b'
FX_WORDS     = r'\b(fx|sweep|riser|rise|fall|impact|whoosh|zap|glitch|stutter|transition|uplifter)\b'
STAB_WORDS   = r'\b(stab|hit|chord|shot|blast|jab)\b'
SESS_WORDS   = r'\b(take|takes|session|sessions|rec|recording|live|jam|improv|rehearsal|raw)\b'
STEM_WORDS   = r'\b(stem|stems|part|parts|track|tracks|bounce|print)\b'
BPM_RE       = re.compile(r'\b(\d{2,3})\s?bpm\b|\bbpm\s?(\d{2,3})\b',re.I)
SERIES_RE    = re.compile(r'^(.*?)[ _\-\.#]*?(\d{1,4})$')

FOLDER_ROLES = [
 (r'\bkit|kits\b','kit'), (r'\bmaster|masters|final|finals\b','masters'),
 (r'\bsession|sessions|takes|recordings\b','sessions'),
 (r'\bchop|chops|slice|slices\b','chops'),
 (r'\bloop|loops\b','loops'), (r'\bsample|samples\b','samples'),
 (r'\bedit|edits\b','edits'), (r'\barchive|old\b','archive'),
 (r'\bmp3|render|renders|bounce\b','renders'),
 (r'\bpatch|patches|preset|presets\b','patches'),
]
CACHE_EXT = {'.asd','.ovw','.nov','.reapeaks','.pkf','.sfk','.db','.ini','.ds_store','.tmp','.bak'}
DOC_EXT   = {'.txt','.md','.pdf','.rtf','.doc','.docx','.html','.tsv','.csv','.nfo'}
AUDIO_EXT = {'.aiff','.aif','.aifc','.wav','.sd2','.mp3','.flac','.ogg','.m4a','.snd','.au','.caf',''}

def ext80(b):
    try:
        e=struct.unpack('>H',b[:2])[0]; m=struct.unpack('>Q',b[2:10])[0]
        return 0 if (e==0 and m==0) else int(m*(2.0**(e-16383-63)))
    except: return 0

def probe(p,sz):
    """Seek-based chunk walk - correct regardless of where COMM/fmt sits in the file."""
    try:
        fh=open(p,'rb'); d=fh.read(64)
    except Exception as e: return ('UNREADABLE',0,0,0,0.0,str(e)[:30])
    if sz==0:
        try: fh.close()
        except: pass
        return ('EMPTY',0,0,0,0.0,'zero bytes')
    try:
        if d[:4]==b'FORM' and d[8:12] in (b'AIFF',b'AIFC'):
            form=d[8:12].decode(); o=12; ch=bits=sr=fr=0; comp=''
            while o+8<=sz and o<sz:
                fh.seek(o); hd=fh.read(8)
                if len(hd)<8: break
                cid=hd[:4]; csz=struct.unpack('>I',hd[4:8])[0]
                if cid==b'COMM':
                    body=fh.read(min(csz,40))
                    if len(body)>=18:
                        ch,fr,bits=struct.unpack('>hIh',body[:8]); sr=ext80(body[8:18])
                        if form=='AIFC' and len(body)>=22: comp=body[18:22].decode('latin1','replace')
                if csz<=0: break
                o+=8+csz+(csz&1)
            fh.close()
            return (form+(':'+comp if comp else ''),sr,bits,ch,(fr/sr if sr else 0.0),
                    '' if sr else 'COMM chunk not found')
        if d[:4]==b'RIFF' and d[8:12]==b'WAVE':
            o=12; ch=bits=sr=0; datasz=0; fmt='WAV'
            while o+8<=sz:
                fh.seek(o); hd=fh.read(8)
                if len(hd)<8: break
                cid=hd[:4]; csz=struct.unpack('<I',hd[4:8])[0]
                if cid==b'fmt ':
                    body=fh.read(min(csz,40))
                    if len(body)>=16:
                        af,ch,sr,br,ba,bits=struct.unpack('<HHIIHH',body[:16])
                        if af==3: fmt='WAV-float32'
                        elif af==65534: fmt='WAV-ext'
                        elif af!=1: fmt='WAV-comp%d'%af
                elif cid==b'data': datasz=csz; break
                if csz<=0: break
                o+=8+csz+(csz&1)
            fh.close()
            if not datasz: datasz=max(0,sz-44)
            dur=datasz/(sr*ch*bits/8) if sr and ch and bits else 0.0
            return (fmt,sr,bits,ch,dur,'')
        fh.seek(0); d=fh.read(4096); fh.close()
    except Exception as e:
        try: fh.close()
        except: pass
        return ('UNREADABLE',0,0,0,0.0,str(e)[:30])
    if d[:3]==b'ID3' or (len(d)>1 and d[0]==0xFF and (d[1]&0xE0)==0xE0):
        off=0
        if d[:3]==b'ID3' and len(d)>10:
            off=10+((d[6]&0x7f)<<21|(d[7]&0x7f)<<14|(d[8]&0x7f)<<7|(d[9]&0x7f))
        BR=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]; SR={0:44100,1:48000,2:32000}
        for i in range(off,min(len(d)-4,off+2048)):
            if d[i]==0xFF and (d[i+1]&0xE0)==0xE0:
                ver=(d[i+1]>>3)&3; br=BR[(d[i+2]>>4)&0xF]; sri=(d[i+2]>>2)&3
                if br and sri in SR:
                    srr=SR[sri]//(1 if ver==3 else 2)
                    chn=1 if ((d[i+3]>>6)&3)==3 else 2
                    return ('MP3',srr,0,chn,(sz-off)*8.0/(br*1000),'CBR duration from frame header')
                break
        return ('MP3',0,0,0,sz/20000.0,'duration ESTIMATED from size')
    if d[:4]==b'OggS': return ('OGG',0,0,0,0.0,'')
    if d[:4]==b'fLaC': return ('FLAC',0,0,0,0.0,'')
    if d[4:8]==b'ftyp': return ('MP4/M4A',0,0,0,0.0,'')
    e=os.path.splitext(p)[1].lower(); est=sz/(44100*2*2)
    if e in ('.aif','.aiff','.aifc','.wav'):
        return ('RAW-PCM',0,0,0,est,'ext says %s but no header - headerless; duration ESTIMATED'%e)
    return ('RAW-PCM',0,0,0,est,'headerless - specs unknown; duration ESTIMATED')

def band(d):
    if d<=0: return 'unknown'
    if d<1.0: return 'A <1s'
    if d<2.5: return 'B 1-2.5s'
    if d<8:   return 'C 2.5-8s'
    if d<30:  return 'D 8-30s'
    if d<90:  return 'E 30-90s'
    if d<300: return 'F 90s-5m'
    return 'G >5m'

def find(pats,text):
    for pat,val in pats:
        if re.search(pat,text,re.I): return val
    return ''

def role_of(text):
    for pat,val in FOLDER_ROLES:
        if re.search(pat,text,re.I): return val
    return ''

def classify(name,stem,chain,dur,sz,fmt,ext,series,machine_folder):
    """returns (category, confidence, reasons[], machine, instrument, descriptor)"""
    R=[]; low=stem.lower(); ctx=(" ".join(chain)+" "+low).lower()
    if ext in CACHE_EXT: return ('CACHE','high',['cache extension %s'%ext],'','','')
    if ext in DOC_EXT:   return ('DOCUMENT','high',['doc extension %s'%ext],'','','')
    if fmt=='EMPTY':     return ('BROKEN','high',['zero bytes'],'','','')
    if fmt in ('OTHER','UNREADABLE'): return ('UNKNOWN-FORMAT','high',['no recognised header'],'','','')
    machine = find(MACHINES,low) or machine_folder
    if machine: R.append('machine=%s'%machine + ('' if find(MACHINES,low) else ' (from folder)'))
    inst = find(INSTRUMENTS,low)
    if inst: R.append('instrument token=%s'%inst)
    desc=[]
    for d in DESCRIPTORS:
        m=re.findall(d,low)
        desc += [x if isinstance(x,str) else x[0] for x in m]
    desc=" ".join(dict.fromkeys([d for d in desc if d]))
    bpm=BPM_RE.search(low)
    if bpm: R.append('bpm in name')
    role = role_of(" ".join(chain))
    if role: R.append('folder role=%s'%role)
    # ---- decision ladder
    if re.search(SONG_WORDS,ctx):
        R.append('song keyword')
        if dur>=90 or dur==0: return ('SONG','high',R,machine,inst,desc)
        return ('SONG?','low',R+['but short (%.1fs)'%dur],machine,inst,desc)
    if role=='masters' or role=='renders':
        if dur>=90: return ('SONG','high',R+['in masters/renders folder'],machine,inst,desc)
    if dur>=300: return ('LONG-SESSION','med',R+['>5 min'],machine,inst,desc)
    if dur>=90:
        if re.search(SESS_WORDS,ctx): return ('SESSION-TAKE','med',R+['session keyword + long'],machine,inst,desc)
        if re.search(STEM_WORDS,ctx): return ('STEM','med',R+['stem keyword + long'],machine,inst,desc)
        return ('SONG?','low',R+['90s-5m, no keyword'],machine,inst,desc)
    DRUMS=('Kick','Snare','Hat','Hat Closed','Hat Open','Clap','Tom','Rim','Crash','Ride',
           'Cowbell','Clave','Conga','Shaker','Tambourine','Perc','Stick')
    if inst=='Vocal':
        return ('VOCAL','med' if dur and dur<30 else 'low',R,machine,inst,desc)
    # a drum token on a short file beats series numbering - kits are numbered too
    if inst in DRUMS and dur and dur<3.0:
        return ('DRUM-ONESHOT','high' if machine else 'med',
                R+['drum token + %.2fs'%dur]+(['numbered, but drum token wins'] if series else []),
                machine,inst,desc)
    if dur and dur<1.0 and (role=='kit' or machine):
        return ('DRUM-ONESHOT','med',R+['<1s inside kit/machine context'],machine,inst,desc)
    if re.search(FX_WORDS,ctx):
        return ('FX','med',R+['fx keyword'],machine,inst,desc)
    if re.search(PAD_WORDS,ctx) and dur>=8:
        return ('PAD-BED','med',R+['pad/atmos keyword + sustained'],machine,inst,desc)
    if re.search(STAB_WORDS,ctx) and dur and dur<8:
        return ('SYNTH-STAB','med',R+['stab keyword'],machine,inst,desc)
    if series and series[2]>=3 and dur and 0.3<=dur<20 and inst not in DRUMS:
        return ('CHOP','med',R+['numbered series "%s" (%d of %d), no drum token'%series,],machine,inst,desc)
    if re.search(LOOP_WORDS,ctx) or bpm:
        return ('LOOP','med',R+['loop keyword/bpm'],machine,inst,desc)
    if inst in DRUMS and dur and dur<8:
        return ('DRUM-HIT-LONG','low',R+['drum token, %.1fs'%dur],machine,inst,desc)
    if inst and dur and dur<8:
        return ('TONAL-HIT','low',R+['%s token, %.1fs'%(inst,dur)],machine,inst,desc)
    if dur and dur<1.0:  return ('ONE-SHOT','low',R+['<1s, untyped'],machine,inst,desc)
    if dur and dur<8:    return ('SAMPLE-SHORT','low',R+['%.1fs, untyped'%dur],machine,inst,desc)
    if dur and dur<30:   return ('SAMPLE','low',R+['%.1fs, untyped'%dur],machine,inst,desc)
    if dur and dur<90:   return ('SECTION-BED','low',R+['%.0fs, untyped - section or bed'%dur],machine,inst,desc)
    return ('UNKNOWN','low',R+['no duration or signal'],machine,inst,desc)

def propose(cat,machine,inst,desc,stem,idx,ext):
    """suggested target name - PROPOSAL ONLY, nothing is renamed by this script"""
    def t(s): return " ".join(w for w in s.split() if w).strip()
    if cat=='DRUM-ONESHOT':
        parts=[machine or '', inst or '', desc or '']
        base=t(" ".join(parts))
        return (base+(" %02d"%idx if idx else "")+ext) if base else ''
    if cat=='CHOP':
        return t("%s chop %03d"%(stem_root(stem),idx or 0))+ext if idx else ''
    if cat in ('SONG','SONG?'):
        return t(stem)+ext
    return ''

def stem_root(s):
    m=SERIES_RE.match(s)
    return (m.group(1).strip(' _-.#') if m else s)

def esc(s): return str(s).replace('\t',' ').replace('\n',' ').replace('\r',' ')

FIELDS=["batch","root_folder","parent_chain","rel_path","filename","stem","ext","bytes","modified",
        "format","samplerate","bits","channels","duration_s","duration_band",
        "category","confidence","machine","instrument","descriptor",
        "series_root","series_index","series_size","proposed_name","reasons","notes"]
FFIELDS=["root_folder","files","bytes","audio_files","total_minutes","oldest","newest","subdirs","depth",
         "detected_machine","folder_role","dominant_category","category_mix","format_mix","flagged"]

def run(budget,batch):
    """Directory-level checkpointing: a huge folder is chunked across passes."""
    from collections import Counter
    st=json.load(open(ST)) if os.path.exists(ST) else {}
    AGG=D('state-agg.json')
    agg=json.load(open(AGG)) if os.path.exists(AGG) else {}
    tops=sorted(x for x in os.listdir(ING) if os.path.isdir(os.path.join(ING,x)))
    end=time.time()+budget
    nf=open(FILES,'a',encoding='utf-8',newline=''); wf=csv.DictWriter(nf,fieldnames=FIELDS,delimiter='\t',extrasaction='ignore')
    nd=open(FOLD,'a',encoding='utf-8',newline=''); wd=csv.DictWriter(nd,fieldnames=FFIELDS,delimiter='\t',extrasaction='ignore')
    donefolders=0
    for t in tops:
        if st.get('ROOT::'+t)=='done' or time.time()>end: continue
        p=os.path.join(ING,t)
        mfolder=find(MACHINES,t)
        a=agg.setdefault(t,{"n":0,"b":0,"aud":0,"dur":0.0,"mn":None,"mx":None,"dep":0,"sub":0,
                            "flag":0,"cats":{},"fmts":{}})
        finished=True
        for dp,dn,fn in os.walk(p):
            key=os.path.relpath(dp,ING)
            if st.get(key)=='done': continue
            if time.time()>end: finished=False; break
            rel=os.path.relpath(dp,p)
            chain=[] if rel=='.' else rel.split(os.sep)
            a["dep"]=max(a["dep"],len(chain)); a["sub"]+=len(dn)
            fullchain=[t]+chain
            mfold2=find(MACHINES," ".join(fullchain)) or mfolder
            roots={}
            for f in fn:
                stem0=os.path.splitext(f)[0]; m=SERIES_RE.match(stem0)
                if m and m.group(2): roots.setdefault(m.group(1).strip(' _-.#').lower(),[]).append(1)
            for f in fn:
                fp=os.path.join(dp,f)
                try: sz=os.path.getsize(fp); mt=os.path.getmtime(fp)
                except: continue
                a["n"]+=1; a["b"]+=sz
                stem,ext=os.path.splitext(f); ext=ext.lower()
                mtime=time.strftime("%Y-%m-%d",time.localtime(mt))
                a["mn"]=mtime if a["mn"] is None or mtime<a["mn"] else a["mn"]
                a["mx"]=mtime if a["mx"] is None or mtime>a["mx"] else a["mx"]
                if ext in CACHE_EXT or ext in DOC_EXT or f in ('.DS_Store','Icon'):
                    fmt,sr,bits,ch,dur,note=('NON-AUDIO',0,0,0,0.0,'')
                else:
                    fmt,sr,bits,ch,dur,note=probe(fp,sz)
                ser=None; m=SERIES_RE.match(stem)
                if m and m.group(2):
                    rt=m.group(1).strip(' _-.#').lower()
                    if len(roots.get(rt,[]))>=2: ser=(rt,int(m.group(2)),len(roots[rt]))
                cat,conf,reasons,machine,inst,desc=classify(f,stem,fullchain,dur,sz,fmt,ext,ser,mfold2)
                pn=propose(cat,machine,inst,desc,stem,ser[1] if ser else 0,ext)
                a["fmts"][fmt]=a["fmts"].get(fmt,0)+1; a["cats"][cat]=a["cats"].get(cat,0)+1
                a["dur"]+=dur
                if fmt not in ('NON-AUDIO','EMPTY','OTHER','UNREADABLE'): a["aud"]+=1
                if note: a["flag"]+=1
                wf.writerow({"batch":batch,"root_folder":esc(t),"parent_chain":esc(" > ".join(fullchain)),
                    "rel_path":esc(os.path.relpath(fp,p)),"filename":esc(f),"stem":esc(stem),"ext":ext,
                    "bytes":sz,"modified":mtime,"format":fmt,"samplerate":sr,"bits":bits,"channels":ch,
                    "duration_s":"%.3f"%dur,"duration_band":band(dur),"category":cat,"confidence":conf,
                    "machine":esc(machine),"instrument":esc(inst),"descriptor":esc(desc),
                    "series_root":esc(ser[0]) if ser else "","series_index":ser[1] if ser else "",
                    "series_size":ser[2] if ser else "","proposed_name":esc(pn),
                    "reasons":esc("; ".join(reasons)),"notes":esc(note)})
            st[key]='done'
            nf.flush(); json.dump(st,open(ST,'w')); json.dump(agg,open(AGG,'w'))
        if finished:
            C=Counter(a["cats"]); F=Counter(a["fmts"])
            wd.writerow({"root_folder":esc(t),"files":a["n"],"bytes":a["b"],"audio_files":a["aud"],
                "total_minutes":"%.1f"%(a["dur"]/60),"oldest":a["mn"] or "","newest":a["mx"] or "",
                "subdirs":a["sub"],"depth":a["dep"],"detected_machine":esc(mfolder),
                "folder_role":esc(role_of(t)),
                "dominant_category":C.most_common(1)[0][0] if C else "",
                "category_mix":esc(", ".join("%s:%d"%(k,v) for k,v in C.most_common(6))),
                "format_mix":esc(", ".join("%s:%d"%(k,v) for k,v in F.most_common(5))),"flagged":a["flag"]})
            st['ROOT::'+t]='done'; donefolders+=1
            nd.flush(); json.dump(st,open(ST,'w'))
    nf.close(); nd.close(); json.dump(st,open(ST,'w')); json.dump(agg,open(AGG,'w'))
    roots_done=sum(1 for k in st if k.startswith('ROOT::'))
    print("folders completed this pass: %d | total %d / %d | dirs cached: %d"%(donefolders,roots_done,len(tops),len(st)))

if __name__=="__main__":
    budget=33; batch=1; reset='--reset' in sys.argv
    for a in sys.argv[1:]:
        if a.isdigit(): budget=int(a)
        if a.startswith('--batch='): batch=int(a.split('=')[1])
    if reset:
        for f in (ST,FILES,FOLD):
            if os.path.exists(f): os.remove(f)
    if not os.path.exists(FILES):
        with open(FILES,'w',encoding='utf-8',newline='') as fh:
            csv.DictWriter(fh,fieldnames=FIELDS,delimiter='\t').writeheader()
        with open(FOLD,'w',encoding='utf-8',newline='') as fh:
            csv.DictWriter(fh,fieldnames=FFIELDS,delimiter='\t').writeheader()
    run(budget,batch)
