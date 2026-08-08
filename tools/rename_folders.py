# -*- coding: utf-8 -*-
"""
Folder renamer:  "<Level1> <Level2> - <Cleaned Original Name>"
Reads the file-level index, classifies each folder from its AUDIO files only,
writes a preview TSV. Renames ONLY with --apply. Always writes a manifest.
Usage: python3 rename_folders.py [--apply] [--dir=INGEST|ROOT]
"""
import os,sys,csv,re,json
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
BASE=APP                                        # data + html live beside tools
WORK=_os.path.join(APP,"work"); _os.makedirs(WORK,exist_ok=True)
def W(n): return _os.path.join(WORK,n)
FILES=W('ingest2_files.tsv')
ROOT=LIB




IGNORE={'CACHE','DOCUMENT','BROKEN','UNKNOWN-FORMAT'}
SMALL={'a','an','and','the','of','in','on','at','to','for','from','by','or','vs','with'}
ACRO={'tr':'TR','bd':'BD','sd':'SD','hh':'HH','mpc':'MPC','emu':'E-mu','ni':'NI','sp':'SP',
      'lm':'LM','drm':'DRM','sds':'SDS','rd':'RD','uk':'UK','usa':'USA','mp3':'MP3','cd':'CD',
      'aiff':'AIFF','wav':'WAV','eq':'EQ','fx':'FX','dj':'DJ','ep':'EP','lp':'LP','rnb':'RnB',
      'io':'IO','ii':'II','iii':'III','iv':'IV','asoor':'ASOOR','atman':'ATMAN','kb6':''}

def clean(name):
    s=name
    s=re.sub(r'^\s*[\[\(\{][^\]\)\}]{1,12}[\]\)\}]\s*[_\-]?','',s)   # leading [KB6]_ style tag
    s=re.sub(r'[\[\]\{\}]',' ',s)
    s=s.replace('_',' ')
    s=re.sub(r"[^A-Za-z0-9 \-&+.']",' ',s)
    s=re.sub(r'\s*-\s*',' - ',s) if ' - ' in s else s
    s=re.sub(r'\s+',' ',s).strip(' -.')
    out=[]
    for i,w in enumerate(s.split(' ')):
        lw=w.lower().strip(".'")
        if lw in ACRO and ACRO[lw]: out.append(ACRO[lw])
        elif re.match(r'^\d',w): out.append(w.upper() if re.search(r'[a-z]',w) and len(w)<7 else w)
        elif lw in SMALL and i>0: out.append(lw)
        elif w.isupper() and len(w)>1: out.append(w)
        else: out.append(w[:1].upper()+w[1:] if w else w)
    return re.sub(r'\s+',' ',' '.join(x for x in out if x)).strip()

def levels(folder,rows):
    aud=[r for r in rows if r['category'] not in IGNORE]
    n=len(aud); low=folder.lower()
    if n==0: return ('Review','Empty',0.0)
    dom,cnt=Counter(r['category'] for r in aud).most_common(1)[0]
    share=cnt/n
    mach=Counter(r['machine'] for r in aud if r['machine'])
    machine=mach.most_common(1)[0][0] if mach else ''
    soft = machine in ('NI Absynth','NI Kontakt','NI Battery','Halion')
    role=''
    if re.search(r'\bkit',low): role='kit'
    if dom in ('DRUM-ONESHOT','DRUM-HIT-LONG'):
        if machine and not soft: return ('Drum','Machine',share)
        if re.search(r'acoustic|live|real|studio drum',low): return ('Drum','Acoustic',share)
        if role=='kit' or soft: return ('Drum','Kit',share)
        return ('Drum','Hits',share)
    if dom=='CHOP':        return ('Sample','Chops',share)
    if dom=='FX':          return ('Sample','FX',share)
    if dom=='PAD-BED':     return ('Sample','Pads',share)
    if dom=='LOOP':        return ('Sample','Loops',share)
    if dom=='SECTION-BED': return ('Sample','Beds',share)
    if dom in ('ONE-SHOT','SAMPLE-SHORT'): return ('Sample','Oneshots',share)
    if dom=='SAMPLE':      return ('Sample','General',share)
    if dom in ('SYNTH-STAB','TONAL-HIT'):  return ('Synth','Hits',share)
    if dom=='VOCAL':       return ('Vocal','Takes',share)
    if dom=='STEM':        return ('Session','Stems',share)
    if dom=='SESSION-TAKE':return ('Session','Takes',share)
    if dom in ('SONG','SONG?'):
        if re.search(r'master|final|beatport|release|render|mp3',low): return ('Song','Masters',share)
        return ('Song','Mixes',share)
    if dom=='LONG-SESSION':
        if re.search(r'master|final|beatport|release|render|album|mp3',low): return ('Song','Masters',share)
        if re.search(r'live|tour|gig|concert|perform',low): return ('Session','Live',share)
        return ('Session','Long',share)
    return ('Review','Unsorted',share)

def main():
    apply='--apply' in sys.argv
    tgt=ING
    for a in sys.argv:
        if a=='--dir=ROOT': tgt=ROOT
    rows=defaultdict(list)
    for r in csv.DictReader(open(FILES,encoding='utf-8'),delimiter='\t'):
        rows[r['root_folder']].append(r)
    present=set(x for x in os.listdir(tgt) if os.path.isdir(os.path.join(tgt,x)))
    plan=[]; seen=Counter()
    for f in sorted(rows):
        if f not in present: continue
        l1,l2,share=levels(f,rows[f])
        new="%s %s - %s"%(l1,l2,clean(f))
        if new in seen: 
            seen[new]+=1; new="%s (%d)"%(new,seen[new])
        else: seen[new]+=1
        plan.append((f,new,l1,l2,"%.2f"%share,len(rows[f])))
    with open(W('rename_plan.tsv'),'w',encoding='utf-8',newline='') as fh:
        w=csv.writer(fh,delimiter='\t'); w.writerow(["old","new","level1","level2","dominant_share","files"])
        for p in plan: w.writerow(p)
    print("planned: %d folders (of %d indexed, %d present in %s)"%(len(plan),len(rows),len(present),os.path.basename(tgt)))
    print("level mix:",dict(Counter("%s %s"%(p[2],p[3]) for p in plan).most_common()))
    if not apply:
        print("\nPREVIEW ONLY - run with --apply to rename\n")
        for p in plan[:25]: print("   %-44s ->  %s"%(p[0][:44],p[1]))
        return
    ok=0; err=[]
    for old,new,l1,l2,sh,nf in plan:
        if old==new: continue
        s=os.path.join(tgt,old); d=os.path.join(tgt,new)
        if os.path.exists(d): err.append((old,"target exists")); continue
        try: os.rename(s,d); ok+=1
        except Exception as e: err.append((old,str(e)[:60]))
    print("renamed: %d | errors: %d"%(ok,len(err)))
    for e in err[:8]: print("   !",e)
if __name__=="__main__": main()
