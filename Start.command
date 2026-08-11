#!/bin/sh
# Audio Edit & Tag — macOS launcher.
#
# Double-click this file. It starts the local server, opens your browser at it,
# and keeps running until you close this window or press Ctrl-C.
#
# Everything the app remembers — your tags, presets, sessions and the library
# path — lives in the "data" folder next to this launcher. It is deliberately
# NOT inside core/target, because "cargo clean" would delete it.

set -e
cd "$(dirname "$0")"

AUDIOLAB_DATA="$PWD/data"
export AUDIOLAB_DATA

# Whichever binary is NEWER, rather than whichever comes first in the list.
#
# This used to prefer bin/ outright, which is a quiet trap for anyone working on
# the source: rebuild, double-click, and the launcher runs the shipped copy from
# weeks ago while every change you just made appears to have done nothing. bin/
# went three days stale that way before anyone noticed.
BIN=""
for candidate in "./bin/audiolab" "./core/target/release/audiolab"; do
  if [ -x "$candidate" ]; then
    if [ -z "$BIN" ] || [ "$candidate" -nt "$BIN" ]; then
      BIN="$candidate"
    fi
  fi
done

if [ -z "$BIN" ]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "No built binary found — building it once. This takes a minute."
    echo
    cargo build --release --manifest-path core/Cargo.toml
    BIN="./core/target/release/audiolab"
  else
    echo
    echo "Could not find the Audio Edit & Tag program, and Rust is not"
    echo "installed to build it."
    echo
    echo "Either restore bin/audiolab, or install Rust from https://rustup.rs"
    echo "and double-click this file again."
    echo
    echo "Press Return to close."
    read -r _
    exit 1
  fi
fi

# First run only: point it at the bundled library so it opens on something
# rather than an empty picker. Once a library has been chosen it is stored in
# data/config.json, and passing one on the command line would override it.
if [ $# -eq 0 ] && [ ! -f "$AUDIOLAB_DATA/config.json" ] && [ -d "./Audio Library" ]; then
  set -- "./Audio Library"
fi

exec "$BIN" "$@"
