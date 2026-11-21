"""Make sounds from words with TangoFlux, on the PC.

    venv\\Scripts\\python make_tangoflux.py --prompt "metal door slam in a cathedral" --seconds 4 --n 2

TangoFlux (declare-lab, 515M) is a text-to-sound model: effects, textures, hits,
44.1 kHz stereo, 1 to 30 seconds, about a second a sound on the 3060. It follows
a description closely, which is what it is for here, beside Stable Audio Open.

Licence: research and non-commercial use only (its LICENSE.md), on top of the
Stability AI Community Licence it is built under. Personal use, as RJ asked
(14 Nov 2026); not for anything sold. See WORK DIR/page-mockups/MODELS.md.

Speaks the same protocol as make.py (Stable Audio Open), so the server's bridge
(`core/crates/server-core/src/gpu.rs`) can drive either: with --serve, one JSON
request a line on stdin, {"id", "prompt", "seconds", "n", "seed", "out"}; one
line per sound, {"id", "path", ...}; then {"id", "done": true} or {"id", "error"}.
Deployed to C:\\Users\\rjval\\agent-net\\tangoflux\\make.py.
"""

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# The weights and its T5 text encoder live beside this script, not in the user's cache.
os.environ.setdefault("HF_HOME", os.path.join(HERE, "hf"))

import torch  # noqa: E402
import soundfile as sf  # noqa: E402
from tangoflux import TangoFluxInference  # noqa: E402

RATE = 44100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--seed", type=int, default=1)
    # 25 steps: what the authors call nearly the quality of 50, at half the time.
    ap.add_argument("--steps", type=int, default=25)
    ap.add_argument("--cfg", type=float, default=4.5)
    ap.add_argument("--out", default="tries")
    ap.add_argument("--serve", action="store_true", help="keep the model loaded; read JSON requests from stdin, one a line")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    torch.set_num_threads(4)

    t0 = time.time()
    model = TangoFluxInference(name="declare-lab/TangoFlux", device="cuda" if torch.cuda.is_available() else "cpu")
    print(json.dumps({"loaded": round(time.time() - t0, 1), "device": "cuda" if torch.cuda.is_available() else "cpu"}), flush=True)
    if a.serve:
        print(json.dumps({"ready": True}), flush=True)
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            req = {}
            try:
                req = json.loads(line)
                a.seed = int(req.get("seed", a.seed))
                a.out = req.get("out", a.out)
                os.makedirs(a.out, exist_ok=True)
                make(model, a, req, tag=req.get("id"))
                print(json.dumps({"id": req.get("id"), "done": True}), flush=True)
            except Exception as e:  # report, and keep serving
                print(json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)
        return
    make(model, a, {"prompt": a.prompt, "seconds": a.seconds, "n": a.n})


# The latent is one frame per 2048 samples. TangoFlux always draws its whole 30 s
# (645 frames) and its own generate() then decodes all of it: 10.8 GB and 4.8 s on the
# 3060 for a 4 s sound. The decoder is convolutional, so decoding just the frames the
# sound needs, plus this many past its end, gives the same audio (65 dB down) in 0.15 s.
SPARE_FRAMES = 16


def generate(model, prompt, seed, steps, secs, cfg):
    """TangoFluxInference.generate, but seeded and decoding only what is kept.

    Its generate() never passes a seed on, so inference_flow seeded every try with 0:
    every sound of a prompt and length came out the same (fixed 17 Nov 2026). The
    flow runs with TF32 matmuls (3.6 s against 4.2 s; 51 dB from full fp32, the same
    sound); bf16 and fp16 were tried and are not the same sound (fp16 overflows).
    """
    tf32 = torch.backends.cuda.matmul.allow_tf32, torch.backends.cudnn.allow_tf32
    torch.backends.cuda.matmul.allow_tf32 = torch.backends.cudnn.allow_tf32 = True
    try:
        with torch.no_grad():
            lat = model.model.inference_flow(prompt, duration=secs, num_inference_steps=steps,
                                             guidance_scale=cfg, seed=seed, disable_progress=True)
    finally:
        torch.backends.cuda.matmul.allow_tf32, torch.backends.cudnn.allow_tf32 = tf32
    keep = int(secs * RATE)
    frames = min(lat.shape[1], -(-keep // 2048) + SPARE_FRAMES)
    with torch.no_grad():
        wave = model.vae.decode(lat[:, :frames].float().transpose(2, 1)).sample.cpu()[0]
    return wave[:, :keep]


def make(model, a, job, tag=None):
    # The model's own range is 1 to 30 seconds.
    secs = max(1.0, min(30.0, float(job.get("seconds", a.seconds))))
    prompt = job.get("prompt", "")
    if not prompt:
        raise ValueError("TangoFlux needs words to make a sound from")
    slug = job.get("name") or re.sub(r"[^a-z0-9]+", "-", prompt.lower()).strip("-")[:40] or "sound"
    for i in range(int(job.get("n", a.n))):
        seed = a.seed + i
        t1 = time.time()
        wave = generate(model, prompt, seed, int(job.get("steps", a.steps)), secs, a.cfg)
        x = wave.to(torch.float32).numpy().T
        pk = float(abs(x).max()) or 1.0
        path = os.path.join(a.out, f"{slug}-tf-{seed}.wav")
        sf.write(path, x / pk * 0.89, RATE, subtype="FLOAT")
        print(json.dumps({"id": tag, "path": path, "prompt": prompt, "seed": seed, "seconds": round(len(x) / RATE, 3),
                          "took": round(time.time() - t1, 2), "model": "tangoflux"}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
