"""Make sounds from words with Stable Audio Open Small, on this Mac.

    venv/bin/python make.py --prompt "deep dub techno kick" --seconds 1.5 --n 4 --out tries/

Writes <out>/<slug>-<seed>.wav (32-bit float, 44.1 kHz stereo), and prints one
JSON line per sound. The model loads once and makes all n. Personal use, under
the Stability AI Community License (see WORK DIR/page-mockups/MODELS.md).
"""

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# Everything the model pulls in (the T5 text encoder) lives on the external drive.
os.environ.setdefault("HF_HOME", os.path.join(HERE, "..", "cache", "hf"))
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import torch  # noqa: E402
import soundfile as sf  # noqa: E402
from stable_audio_tools.models.factory import create_model_from_config  # noqa: E402
from stable_audio_tools.models.utils import load_ckpt_state_dict  # noqa: E402
from stable_audio_tools.inference.generation import generate_diffusion_cond  # noqa: E402

WEIGHTS = os.path.join(HERE, "weights")


def load(device):
    with open(os.path.join(WEIGHTS, "model_config.json")) as f:
        cfg = json.load(f)
    # A T5 kept in a plain folder beside the weights (as on the PC) is used from there.
    t5 = os.path.join(HERE, "t5-base")
    if os.path.isdir(t5):
        for c in cfg["model"]["conditioning"]["configs"]:
            if c["type"] == "t5":
                c["config"]["model_path"] = t5
    model = create_model_from_config(cfg)
    model.load_state_dict(load_ckpt_state_dict(os.path.join(WEIGHTS, "model.safetensors")))
    return model.to(device).eval(), cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--batch", help="a JSON list of {name, prompt, seconds, n}: one model load for all")
    ap.add_argument("--seconds", type=float, default=2.0)
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--out", default="tries")
    ap.add_argument("--serve", action="store_true", help="keep the model loaded; read JSON requests from stdin, one a line")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    torch.set_num_threads(4)  # leave the machine some room
    if a.device == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True

    t0 = time.time()
    model, cfg = load(a.device)
    rate = cfg["sample_rate"]
    print(json.dumps({"loaded": round(time.time() - t0, 1), "device": a.device}), flush=True)
    if a.serve:
        # One request a line: {"id", "prompt", "seconds", "n", "seed", "out"}. Each sound is
        # a line {"id", "path", ...}; the request ends with {"id", "done": true} (or "error").
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
                (blend if req.get("blend") else make)(model, rate, a, req, tag=req.get("id"))
                print(json.dumps({"id": req.get("id"), "done": True}), flush=True)
            except Exception as e:  # report, and keep serving
                print(json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)
        return
    jobs = json.load(open(a.batch)) if a.batch else [{"name": "", "prompt": a.prompt, "seconds": a.seconds, "n": a.n}]
    for job in jobs:
        make(model, rate, a, job)


def make(model, rate, a, job, tag=None):
    secs = max(0.5, min(11.0, float(job.get("seconds", a.seconds))))
    # The latent is 2048 samples a frame; ask for whole frames, then trim.
    size = ((int(secs * rate) + 2047) // 2048) * 2048
    prompt = job.get("prompt", "")
    # A guide sound (variations): its path and how far to move from it, 0 (close) to 1 (far).
    init = None
    if job.get("init"):
        g, gr = sf.read(job["init"], dtype="float32", always_2d=True)
        init = (gr, torch.from_numpy(g.T.copy()))
        if not job.get("seconds"):
            secs = max(0.5, min(11.0, len(g) / gr))
            size = ((int(secs * rate) + 2047) // 2048) * 2048
    slug = job.get("name") or re.sub(r"[^a-z0-9]+", "-", prompt.lower()).strip("-")[:40] or "sound"
    levels = job.get("levels")  # one guide strength per try, near to far
    prompts = job.get("prompts")  # one prompt per try (a kit: its parts)
    for i in range(int(job.get("n", a.n))):
        seed = a.seed + i
        level = float(levels[i % len(levels)]) if levels else float(job.get("near_far", 0.5))
        if prompts:
            prompt = prompts[i % len(prompts)]
            slug = f"part{i:02d}"
        t1 = time.time()
        with torch.no_grad():
            out = generate_diffusion_cond(
                model,
                steps=a.steps,
                cfg_scale=a.cfg,
                conditioning=[{"prompt": prompt, "seconds_total": secs}],
                sample_size=size,
                sample_rate=rate,
                seed=seed,
                device=a.device,
                **({"init_audio": init, "init_noise_level": level} if init else {}),
            )
        x = out[0].to(torch.float32).cpu().numpy().T[: int(secs * rate)]
        pk = float(abs(x).max()) or 1.0
        path = os.path.join(a.out, f"{slug}-{seed}.wav" if not init else f"{slug}-{i:02d}-{seed}.wav")
        sf.write(path, x / pk * 0.89, rate, subtype="FLOAT")
        print(json.dumps({"id": tag, "path": path, "prompt": prompt, "seed": seed, "seconds": round(len(x) / rate, 3), "took": round(time.time() - t1, 2), "guided": init is not None, "near_far": level if init else None}), flush=True)

def blend(model, rate, a, job, tag=None):
    """Two sounds into the model's own sound space (its autoencoder), points part
    way between them back out: n sounds from A to B. With "wander" (0..1) each
    in-between is also re-made by the model from there, that much loosened."""
    from stable_audio_tools.inference.utils import prepare_audio
    pt = model.pretransform
    dtype = next(pt.parameters()).dtype
    raw = [sf.read(path, dtype="float32", always_2d=True) for path in job["blend"][:2]]
    secs = max(0.5, min(11.0, max(len(x) / r for x, r in raw)))
    size = ((int(secs * rate) + 2047) // 2048) * 2048
    lat = []
    with torch.no_grad():
        for x, r in raw:
            t = prepare_audio(torch.from_numpy(x.T.copy()), in_sr=r, target_sr=rate, target_length=size, target_channels=2, device=a.device)
            lat.append(pt.encode(t.to(dtype)))
    n = max(2, int(job.get("n", 7)))
    wander = float(job.get("wander", 0.0))
    for i in range(n):
        f = i / (n - 1)
        t1 = time.time()
        with torch.no_grad():
            z = lat[0] * (1 - f) + lat[1] * f
            audio = pt.decode(z).to(torch.float32)
            if wander > 0.01:
                audio = generate_diffusion_cond(
                    model, steps=a.steps, cfg_scale=a.cfg,
                    conditioning=[{"prompt": job.get("prompt", ""), "seconds_total": secs}],
                    sample_size=size, sample_rate=rate, seed=a.seed + i, device=a.device,
                    init_audio=(rate, audio[0].cpu()), init_noise_level=min(0.8, 0.15 + 0.55 * wander),
                ).to(torch.float32)
        x = audio[0].cpu().numpy().T[: int(secs * rate)]
        pk = float(abs(x).max()) or 1.0
        path = os.path.join(a.out, f"blend-{i:02d}.wav")
        sf.write(path, x / pk * 0.89, rate, subtype="FLOAT")
        print(json.dumps({"id": tag, "path": path, "seed": a.seed + i, "seconds": round(len(x) / rate, 3), "took": round(time.time() - t1, 2), "t": round(f, 3)}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
