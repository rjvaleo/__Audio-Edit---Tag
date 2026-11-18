"""The notes in a sound, many at once, by Basic Pitch (Spotify, Apache 2.0).

Run on the PC by MultiGrainLive's Stems page for a song's "other" stem
(core/crates/server/src/routes/stems.rs sends this file with the stem):

    D:\\models\\basic-pitch\\venv\\Scripts\\python.exe notes_basic_pitch.py stem.flac

Prints one line of JSON: {"notes": [[start s, end s, midi note, loudness 0..1], ...]}.
The ONNX model, on the CPU: it is small, and the card stays free for the sound models.
"""
import json
import logging
import sys

logging.disable(logging.WARNING)  # its notes about the backends that are not installed

from basic_pitch import ICASSP_2022_MODEL_PATH  # noqa: E402
from basic_pitch.inference import predict  # noqa: E402

_, _, events = predict(sys.argv[1], ICASSP_2022_MODEL_PATH)
notes = sorted([round(float(s), 3), round(float(e), 3), int(p), round(float(a), 3)] for s, e, p, a, _ in events)
sys.stdout.write(json.dumps({"notes": notes}) + "\n")
