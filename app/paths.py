# -*- coding: utf-8 -*-
"""Single source of truth for every path. All tools import this.

Layout:
    <repo>/index.html      the browser (entry point)
    <repo>/StartHere.bat   launcher
    <repo>/README.md
    <repo>/app/            everything else - scripts, data, docs (flat, no nesting)

The audio library itself lives OUTSIDE this repo. It is found by, in order:
    1. library_path in app/config.json
    2. the AUDIO_LIBRARY environment variable
    3. a folder named "Audio Library" beside this repo
"""
import os,json,sys
HERE  = os.path.dirname(os.path.abspath(__file__))   # <repo>/app
ROOT  = os.path.dirname(HERE)                        # <repo>
def D(n): return os.path.join(HERE,n)

INDEX_HTML   = os.path.join(ROOT,"index.html")
FILE_INDEX   = D("AUDIO-INDEX.tsv")
FOLDER_INDEX = D("FOLDER-INDEX.tsv")
TAG_INDEX    = D("TAG-INDEX.tsv")
OVERRIDES    = D("TAG-OVERRIDES.json")
WAVEFORMS    = D("waveforms.tsv")
TEMPLATE     = D("browser_template.html")
CONFIG       = D("config.json")

def _cfg():
    try: return json.load(open(CONFIG,encoding="utf-8"))
    except Exception: return {}

def find_library():
    c=_cfg().get("library_path","")
    if c and os.path.isdir(c): return c
    e=os.environ.get("AUDIO_LIBRARY","")
    if e and os.path.isdir(e): return e
    parent=os.path.dirname(ROOT)
    for n in ("Audio Library","audio library","AudioLibrary","Audio_Library"):
        p=os.path.join(parent,n)
        if os.path.isdir(p): return p
    return ""

LIBRARY = find_library()
SKIP = {"ingest","_to_delete","app","system volume information","$recycle.bin","audio edit & tag"}

def scan_roots():
    """top-level folders of the audio library that we index"""
    if not LIBRARY: return []
    out=[]
    for x in sorted(os.listdir(LIBRARY)):
        if x.lower() in SKIP or x.startswith((".","_")): continue
        if os.path.isdir(os.path.join(LIBRARY,x)): out.append(x)
    return out

def folder_path(n): return os.path.join(LIBRARY,n)

def require_library():
    if not LIBRARY:
        print("Cannot locate the audio library.")
        print('Create app\\config.json containing:')
        print('   {"library_path": "E:\\\\Audio Library"}')
        sys.exit(1)
    return LIBRARY
