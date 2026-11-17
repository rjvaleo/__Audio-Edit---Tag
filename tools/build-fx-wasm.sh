#!/bin/sh
# Build the effect rack for the browser: Atmosphere's own effects
# (core/crates/fx-wasm), written to ui/sequencer/atfx.wasm, which the binary
# serves at /sequencer/atfx.wasm. Run it after changing an effect (the fx crate
# or prism-fx), then rebuild the binary.
set -e
cd "$(dirname "$0")/.."
T="${CARGO_TARGET_DIR:-$PWD/core/target}"
(cd core && cargo build -p fx-wasm --release --target wasm32-unknown-unknown)
cp "$T/wasm32-unknown-unknown/release/fx_wasm.wasm" ui/sequencer/atfx.wasm
ls -l ui/sequencer/atfx.wasm
