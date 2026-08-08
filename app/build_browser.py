# -*- coding: utf-8 -*-
import csv,json,os
from collections import defaultdict,Counter
from paths import *
import os as _os
ING=LIBRARY; LIB=LIBRARY
BASE=HERE; APP=HERE; WORK=HERE
def W(n): return D(n)
OUTP=INDEX_HTML



wf={}
for line in open(WAVEFORMS,encoding='utf-8'):
    k,_,v=line.rstrip('\n').partition('\t')
    if v: wf[k]=v
tags={r['folder']:r for r in csv.DictReader(open(TAG_INDEX,encoding='utf-8'),delimiter='\t')}
byf=defaultdict(list)
for r in csv.DictReader(open(FILE_INDEX,encoding='utf-8'),delimiter='\t'):
    byf[r['root_folder']].append(r)
CATS=[];FMTS=[];CONF=['high','med','low']
def ci(c):
    if c not in CATS: CATS.append(c)
    return CATS.index(c)
def fi(f):
    if f not in FMTS: FMTS.append(f)
    return FMTS.index(f)
PLAYABLE={'WAV','WAV-float32','WAV-ext','MP3','FLAC','MP4/M4A','OGG'}
folders=[]
for name in sorted(tags):
    t=tags[name]; files=[]
    for r in byf.get(name,[]):
        if r['category'] in ('CACHE','DOCUMENT'): continue
        files.append([r['filename'],round(float(r['duration_s'] or 0),2),int(r['bytes']),
            ci(r['category']),CONF.index(r['confidence']) if r['confidence'] in CONF else 2,
            int(r['samplerate'] or 0),int(r['bits'] or 0),int(r['channels'] or 0),
            fi(r['format']),wf.get(name+'/'+r['rel_path'],''),
            os.path.dirname(r['rel_path']).replace('\\','/'),
            r['rel_path'].replace('\\','/'),
            1 if r['format'] in PLAYABLE else 0])
    files.sort(key=lambda x:(x[10],x[0].lower()))
    folders.append({"n":name,"a":t['level1'],"b":t['level2'],"m":t['machine'],"c":t['confidence'],
        "s":float(t['dominant_share']),"nf":int(t['files']),"na":int(t['audio_files']),
        "by":int(t['bytes']),"mi":float(t['minutes']),"o":t['oldest'],"w":t['newest'],
        "ins":t['instruments'],"cat":t['categories'],"fmt":t['formats'],"tg":t['tags'],"F":files})
js=json.dumps({"CATS":CATS,"CONF":CONF,"FMTS":FMTS,"D":folders},separators=(',',':'))
TF=sum(f['nf'] for f in folders); TB=sum(f['by'] for f in folders); TM=sum(f['mi'] for f in folders)
H=open(TEMPLATE,encoding='utf-8').read()
H=H.replace('__DATA__',js).replace('__NF__',str(len(folders))).replace('__TF__',format(TF,','))
H=H.replace('__GB__','%.0f'%(TB/1e9)).replace('__HR__','%.0f'%(TM/60))
open(OUTP,'w',encoding='utf-8').write(H)
print("built: %.1f MB | folders %d | waveforms %d"%(len(H)/1e6,len(folders),len(wf)))
