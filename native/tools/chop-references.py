#!/usr/bin/env python3
"""Chop's references for the repository, from a recording of the page.

    python3 native/tools/chop-references.py <recording> <to> [<name>.json]

<recording> is what `tests/ui/chop-port.spec.mjs` wrote (the full one is in
`WORK DIR/idmlab-move/reference-renders/chop-port`). <to> gets the input
(`break.f32`) and `chop-port.json`, in which every array of floats is its
length and the FNV-1a 64 hash of its bytes, and every array of doubles is
written out (Python writes the shortest form that reads back to the same
double). Bytes (`.u8`, the WAVs and MIDI files `chop-edits.spec.mjs`
records) are their length and hash too. The third argument names the
recording's JSON: `chop-port.json` (the default) or `chop-edits.json`. The Rust test (`native/engine-mgl/tests/chop.rs`) checks its own
arrays against the hashes, and against the files themselves when
`CHOP_PORT_REF` names the full recording.
"""
import json, os, shutil, struct, sys

src, dst = sys.argv[1], sys.argv[2]

def fnv(b):
    h = 0xcbf29ce484222325
    for x in b:
        h ^= x
        h = (h * 0x100000001b3) & 0xffffffffffffffff
    return f"{h:016x}"

def slim(v):
    if isinstance(v, list):
        return [slim(x) for x in v]
    if isinstance(v, dict):
        if set(v) == {"f32"}:
            b = open(os.path.join(src, v["f32"]), "rb").read()
            return {"f32": v["f32"], "n": len(b) // 4, "fnv": fnv(b)}
        if set(v) == {"u8"}:
            b = open(os.path.join(src, v["u8"]), "rb").read()
            return {"u8": v["u8"], "n": len(b), "fnv": fnv(b)}
        if set(v) == {"f64"}:
            b = open(os.path.join(src, v["f64"]), "rb").read()
            return {"f64": list(struct.unpack(f"<{len(b) // 8}d", b))}
        return {k: slim(x) for k, x in v.items()}
    return v

name = sys.argv[3] if len(sys.argv) > 3 else "chop-port.json"
doc = json.load(open(os.path.join(src, name)))
doc["cases"] = [dict(c, value=slim(c["value"])) for c in doc["cases"]]
os.makedirs(dst, exist_ok=True)
shutil.copyfile(os.path.join(src, doc["input"]["file"]), os.path.join(dst, doc["input"]["file"]))
with open(os.path.join(dst, name), "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")
