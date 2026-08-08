# -*- coding: utf-8 -*-
"""
Audio Library local server. Stdlib only, no installs.
  * serves the browser UI
  * /audio  streams any file as playable WAV (converts AIFF/AIFC/raw on the fly)
  * /save   writes tag edits back into each folder's _TAGS.txt
Run:  python serve_library.py     then open http://localhost:8737/
"""
import os,sys,json,struct,urllib.parse,posixpath,io,re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from paths import *
import os as _os
ING=LIBRARY; LIB=LIBRARY
BASE=HERE; APP=HERE; WORK=HERE
def W(n): return D(n)
BASE=ROOT
OVR=OVERRIDES
PORT=int(_os.environ.get('LIBPORT','8737'))




if not os.path.isdir(ING):                       # dev/test layout: sibling mount
    alt=os.path.join(os.path.dirname(BASE),"INGEST")
    if os.path.isdir(alt): ING=alt
PORT=int(os.environ.get("LIBPORT","8737"))


def ext80(b):
    e=struct.unpack('>H',b[:2])[0]; m=struct.unpack('>Q',b[2:10])[0]
    return 0 if (e==0 and m==0) else int(m*(2.0**(e-16383-63)))

def describe(path):
    """-> (kind, data_off, data_len, ch, bits, sr, swap)  kind: wav|pcm"""
    sz=os.path.getsize(path)
    with open(path,'rb') as fh:
        head=fh.read(64)
        if head[:4]==b'RIFF' and head[8:12]==b'WAVE':
            return ('wav',0,sz,0,0,0,False)
        if head[:4]==b'FORM' and head[8:12] in (b'AIFF',b'AIFC'):
            isaifc = head[8:12]==b'AIFC'
            o=12; ch=bits=sr=0; comp=b'NONE'; doff=dlen=0
            while o+8<=sz:
                fh.seek(o); hd=fh.read(8)
                if len(hd)<8: break
                cid=hd[:4]; csz=struct.unpack('>I',hd[4:8])[0]
                if cid==b'COMM':
                    b=fh.read(min(csz,40))
                    ch,fr,bits=struct.unpack('>hIh',b[:8]); sr=ext80(b[8:18])
                    if isaifc and len(b)>=22: comp=b[18:22]
                elif cid==b'SSND':
                    b=fh.read(8); off=struct.unpack('>I',b[:4])[0]
                    doff=o+16+off; dlen=max(0,csz-8-off)
                if csz<=0: break
                o+=8+csz+(csz&1)
            if not (ch and bits and sr and dlen): return None
            swap = not (comp in (b'sowt',b'SOWT'))     # sowt is already little-endian
            if bits==32 and comp in (b'fl32',b'FL32'): swap=True
            return ('pcm',doff,dlen,ch,bits,sr,swap)
    return None

def raw_guess(path,q):
    sz=os.path.getsize(path)
    ch=int(q.get('ch',[2])[0]); bits=int(q.get('bits',[16])[0])
    sr=int(q.get('sr',[44100])[0]); swap=q.get('le',['0'])[0]!='1'
    n=(sz//(ch*bits//8))*(ch*bits//8)
    return ('pcm',0,n,ch,bits,sr,swap)

def wav_header(nbytes,ch,bits,sr):
    ba=ch*bits//8; br=sr*ba
    fmt=3 if bits==32 else 1
    return (b'RIFF'+struct.pack('<I',36+nbytes)+b'WAVEfmt '+struct.pack('<IHHIIHH',16,fmt,ch,sr,br,ba,bits)
            +b'data'+struct.pack('<I',nbytes))

def swap_bytes(buf,bits):
    if bits==16:
        a=bytearray(buf); a[0::2],a[1::2]=a[1::2],a[0::2]; return bytes(a)
    if bits==24:
        a=bytearray(buf); a[0::3],a[2::3]=a[2::3],a[0::3]; return bytes(a)
    if bits==32:
        a=bytearray(buf)
        a[0::4],a[1::4],a[2::4],a[3::4]=a[3::4],a[2::4],a[1::4],a[0::4]; return bytes(a)
    return buf

class H(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a): pass
    def _send(self,code,body=b'',ctype='application/json',extra=None):
        self.send_response(code); self.send_header('Content-Type',ctype)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Access-Control-Allow-Origin','*')
        for k,v in (extra or {}).items(): self.send_header(k,v)
        self.end_headers()
        if self.command!='HEAD' and body: self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Content-Length','0'); self.end_headers()
    def do_GET(self):
        u=urllib.parse.urlparse(self.path); q=urllib.parse.parse_qs(u.query)
        p=urllib.parse.unquote(u.path)
        if p in ('/','/index.html'): return self.serve_file(INDEX_HTML,'text/html; charset=utf-8')
        if p=='/ping': return self._send(200,json.dumps({"ok":True,"base":BASE,"ingest":ING}).encode())
        if p=='/audio': return self.audio(q)
        f=os.path.normpath(os.path.join(BASE,p.lstrip('/')))
        if f.startswith(BASE) and os.path.isfile(f):
            ct='text/html; charset=utf-8' if f.endswith('.html') else 'application/octet-stream'
            return self.serve_file(f,ct)
        return self._send(404,b'{"error":"not found"}')
    def serve_file(self,f,ctype):
        try: data=open(f,'rb').read()
        except Exception as e: return self._send(404,json.dumps({"error":str(e)}).encode())
        self._send(200,data,ctype)
    def audio(self,q):
        rel=q.get('p',[''])[0]
        if not rel: return self._send(400,b'{"error":"no path"}')
        path=os.path.normpath(os.path.join(ING,rel.replace('/',os.sep)))
        if not (path.startswith(ING) and os.path.isfile(path)):
            return self._send(404,b'{"error":"no such file"}')
        info=describe(path) or raw_guess(path,q)
        if info[0]=='wav':
            sz=os.path.getsize(path); rng=self.headers.get('Range')
            with open(path,'rb') as fh:
                if rng:
                    m=re.match(r'bytes=(\d+)-(\d*)',rng); a=int(m.group(1)); b=int(m.group(2) or sz-1)
                    b=min(b,sz-1); fh.seek(a); data=fh.read(b-a+1)
                    return self._send(206,data,'audio/wav',{'Content-Range':'bytes %d-%d/%d'%(a,b,sz),'Accept-Ranges':'bytes'})
                return self._send(200,fh.read(),'audio/wav',{'Accept-Ranges':'bytes'})
        _,doff,dlen,ch,bits,sr,swap=info
        total=44+dlen
        rng=self.headers.get('Range'); a=0; b=total-1
        if rng:
            m=re.match(r'bytes=(\d+)-(\d*)',rng)
            if m: a=int(m.group(1)); b=min(int(m.group(2) or total-1),total-1)
        out=io.BytesIO(); hdr=wav_header(dlen,ch,bits,sr)
        if a<44: out.write(hdr[a:min(44,b+1)])
        ds=max(0,a-44); de=b-44
        if de>=0:
            with open(path,'rb') as fh:
                fh.seek(doff+ds); chunk=fh.read(de-ds+1)
            al=ch*bits//8
            if swap and len(chunk)>=al:
                pre=(-ds)%al if ds%al else 0
                body=chunk[:len(chunk)//al*al]
                out.write(swap_bytes(body,bits)); out.write(chunk[len(body):])
            else: out.write(chunk)
        data=out.getvalue()
        code=206 if rng else 200
        ex={'Accept-Ranges':'bytes'}
        if rng: ex['Content-Range']='bytes %d-%d/%d'%(a,a+len(data)-1,total)
        self._send(code,data,'audio/wav',ex)
    def do_POST(self):
        u=urllib.parse.urlparse(self.path)
        n=int(self.headers.get('Content-Length','0')); body=self.rfile.read(n)
        if u.path!='/save': return self._send(404,b'{"error":"not found"}')
        try: payload=json.loads(body.decode('utf-8'))
        except Exception as e: return self._send(400,json.dumps({"error":str(e)}).encode())
        cur={}
        if os.path.exists(OVR):
            try: cur=json.load(open(OVR,encoding='utf-8'))
            except: cur={}
        for k,v in payload.get('folders',{}).items(): cur.setdefault('folders',{})[k]=v
        for k,v in payload.get('files',{}).items():   cur.setdefault('files',{})[k]=v
        json.dump(cur,open(OVR,'w',encoding='utf-8'),indent=1)
        written=[]
        for fname,ov in payload.get('folders',{}).items():
            d=os.path.join(ING,fname)
            if not os.path.isdir(d): continue
            tp=os.path.join(d,'_TAGS.txt')
            try:
                lines=open(tp,encoding='utf-8').read().split('\n') if os.path.exists(tp) else []
                def setline(key,val):
                    for i,l in enumerate(lines):
                        if l.startswith(key+':'):
                            lines[i]="%-12s %s"%(key+':',val); return
                    lines.insert(4,"%-12s %s"%(key+':',val))
                if 'level1' in ov: setline('level1',ov['level1'])
                if 'level2' in ov: setline('level2',ov['level2'])
                if 'tags'   in ov: setline('tags',ov['tags'])
                if 'notes'  in ov: setline('notes',ov['notes'])
                if not any(l.startswith('edited:') for l in lines):
                    lines.insert(4,"%-12s %s"%('edited:','by hand in the library browser'))
                open(tp,'w',encoding='utf-8').write('\n'.join(lines))
                written.append(fname)
            except Exception as e:
                return self._send(500,json.dumps({"error":"%s: %s"%(fname,e)}).encode())
        self._send(200,json.dumps({"ok":True,"folders_written":len(written),
                                   "overrides_file":OVR}).encode())
if __name__=='__main__':
    if not os.path.isdir(ING):
        print("Cannot find INGEST folder next to",BASE); sys.exit(1)
    print("Audio Library server")
    print("  base   :",BASE)
    print("  ingest :",ING)
    print("  open   : http://localhost:%d/"%PORT)
    print("  (Ctrl-C to stop)")
    ThreadingHTTPServer(('127.0.0.1',PORT),H).serve_forever()
