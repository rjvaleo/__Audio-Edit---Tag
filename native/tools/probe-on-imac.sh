#!/bin/zsh
# Build the JUCE probe on the iMac and run it here, on the iMac's sound card,
# gently: nice 15, 4 jobs, and not while the live app on 8737 plays or records.
#
#   tools/probe-on-imac.sh                  the full check (as on 21 Nov 2026)
#   tools/probe-on-imac.sh --buffer 128 ... one run with the probe's own flags
#
# JUCE 9.0.5 is on the 1 TB drive (from JUCE's GitHub, tag 9.0.5, the same
# bytes as the PC's D:\tools\JUCE-9.0.5). The build stays off the main drive.
# Results are added to probe/results/imac-<date>.jsonl. Silent unless the
# probe is given --monitor.
set -e -o pipefail
HERE=${0:A:h:h}
JUCE="/Volumes/1 TB Funtime/WORK DIR/tools/JUCE-9.0.5"
BUILD="/Volumes/1 TB Funtime/WORK DIR/native-build/probe-imac"
OUT="$HERE/probe/results/imac-$(date +%Y%m%d).jsonl"

state=$(curl -s -m 5 localhost:8737/api/engine/state || true)
if [[ $state == *'"playing":true'* || $state == *'"capturing":true'* ]]; then
  echo "8737 is playing or recording: not now"; exit 1
fi

export CARGO_BUILD_JOBS=4
mkdir -p "$BUILD"
cd "$HERE/probe"
[[ -f "$BUILD/CMakeCache.txt" ]] || nice -n 15 cmake -S . -B "$BUILD" -DJUCE_DIR="$JUCE" -DCMAKE_BUILD_TYPE=Release > "$BUILD/configure.log" 2>&1
nice -n 15 cmake --build "$BUILD" --config Release -j 4 > "$BUILD/build.log" 2>&1 || { grep -E '\berror\b' "$BUILD/build.log" | head -20; exit 1; }
PROBE="$BUILD/probe_artefacts/Release/probe"

run() { nice -n 15 "$PROBE" "$@" | tee -a "$OUT"; }
if (( $# )); then run "$@"; exit; fi
run --buffer 128 --seconds 4
for e in 0 1 2 3; do run --buffer 128 --seconds 6 --patch real --engine $e; done
# Moving every message one frame late must make the two differ.
run --buffer 128 --seconds 4 --patch real --skew 1 || true
# Asked for 32, it must run at 64.
run --buffer 32 --seconds 2
