"""Make music from words with ACE-Step 1.5, on the PC.

    ..\\ACE-Step-1.5\\.venv\\Scripts\\python make.py --prompt "dub techno, deep chords, tape delay" --seconds 30 --n 2

ACE-Step 1.5 (ACE Studio and StepFun, MIT licence; outputs usable commercially)
makes music: loops to whole pieces, 10 seconds to 10 minutes, 48 kHz stereo,
instrumental or sung from lyrics. A small language model plans the piece (tempo,
key, structure) and a diffusion model draws it; the turbo model needs 8 steps.

On the 3060 (12 GB): the 2B turbo model and the 1.7B planner, PyTorch backend
(no vLLM on Windows). Its own repository and environment are in
C:\\Users\\rjval\\agent-net\\acestep\\ACE-Step-1.5; this script sits beside it as
acestep\\make.py.

Speaks the same protocol as make.py (Stable Audio Open), so the server's bridge
(`core/crates/server/src/gpu.rs`) can drive it: with --serve, one JSON request a
line on stdin, {"id", "prompt", "seconds", "n", "seed", "out", and optionally
"lyrics", "bpm", "key"}; one line per piece, {"id", "path", ...}; then
{"id", "done": true} or {"id", "error"}. Without lyrics it is instrumental.
"""

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "ACE-Step-1.5")
sys.path.insert(0, ROOT)
os.environ.setdefault("HF_HOME", os.path.join(HERE, "hf"))
# Decode the music in 512-frame chunks, not the 128 ACE-Step picks on a 12 GB card: 30 s
# of music in 2.1 s against 2.6 s, the same 7.3 GB peak, from the same latents (the audio
# differs only by the decoder's bf16 rounding, about 40 dB down). Measured 17 Nov 2026.
os.environ.setdefault("ACESTEP_VAE_DECODE_CHUNK_SIZE", "512")

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402
from acestep.inference import GenerationParams, GenerationConfig, generate_music  # noqa: E402


def load(lm):
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=ROOT, config_path="acestep-v15-turbo", device="auto", offload_to_cpu=False)
    if not ok:
        raise RuntimeError(f"ACE-Step's music model did not load: {msg}")
    planner = None
    if lm != "none":
        planner = LLMHandler()
        msg, ok = planner.initialize(checkpoint_dir=os.path.join(ROOT, "checkpoints"), lm_model_path=lm,
                                     backend="pt", device="auto", offload_to_cpu=False, dtype=None)
        if not ok:
            raise RuntimeError(f"ACE-Step's planner did not load: {msg}")
    return dit, planner


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt")
    ap.add_argument("--lyrics", default="")
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default="tries")
    ap.add_argument("--lm", default="acestep-5Hz-lm-1.7B", help="the planner, or 'none' to go without")
    ap.add_argument("--serve", action="store_true", help="keep the models loaded; read JSON requests from stdin, one a line")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    t0 = time.time()
    dit, planner = load(a.lm)
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
                make(dit, planner, a, req, tag=req.get("id"))
                print(json.dumps({"id": req.get("id"), "done": True}), flush=True)
            except Exception as e:  # report, and keep serving
                print(json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)
        return
    make(dit, planner, a, {"prompt": a.prompt, "lyrics": a.lyrics, "seconds": a.seconds, "n": a.n})


def make(dit, planner, a, job, tag=None):
    prompt = job.get("prompt", "")
    if not prompt:
        raise ValueError("ACE-Step needs words to make music from")
    # The model's own range is 10 seconds to 10 minutes.
    secs = max(10.0, min(600.0, float(job.get("seconds", a.seconds))))
    lyrics = (job.get("lyrics") or "").strip()
    n = max(1, int(job.get("n", a.n)))
    seeds = [a.seed + i for i in range(n)]
    params = GenerationParams(
        task_type="text2music",
        caption=prompt,
        lyrics=lyrics or "[Instrumental]",
        instrumental=not lyrics,
        bpm=job.get("bpm") or None,
        keyscale=job.get("key", ""),
        duration=secs,
        inference_steps=8,
        shift=3.0,  # what the turbo model wants (its INFERENCE.md)
        thinking=planner is not None,
        seed=seeds[0],
    )
    config = GenerationConfig(batch_size=n, use_random_seed=False, seeds=seeds, audio_format="wav")
    t1 = time.time()
    result = generate_music(dit, planner, params=params, config=config, save_dir=None)
    if not result.success:
        raise RuntimeError(result.error or result.status_message)
    took = round((time.time() - t1) / n, 2)
    slug = job.get("name") or re.sub(r"[^a-z0-9]+", "-", prompt.lower()).strip("-")[:40] or "music"
    for i, audio in enumerate(result.audios):
        t = audio["tensor"].to(torch.float32)
        rate = int(audio.get("sample_rate", 48000))
        # 44.1 kHz, as every other maker here writes.
        if rate != 44100:
            import torchaudio.functional as AF
            t = AF.resample(t, rate, 44100)
            rate = 44100
        x = t.numpy().T
        pk = float(abs(x).max()) or 1.0
        seed = int(audio.get("params", {}).get("seed", seeds[min(i, n - 1)]))
        path = os.path.join(a.out, f"{slug}-ace-{seed}.wav")
        sf.write(path, x / pk * 0.89, rate, subtype="FLOAT")
        p = audio.get("params", {})
        print(json.dumps({"id": tag, "path": path, "prompt": prompt, "seed": seed, "seconds": round(len(x) / rate, 3),
                          "took": took, "model": "acestep", "bpm": p.get("bpm") or p.get("cot_bpm"),
                          "key": p.get("keyscale") or p.get("cot_keyscale")}), flush=True)


if __name__ == "__main__":
    sys.exit(main())
