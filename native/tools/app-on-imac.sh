#!/bin/zsh
# Build the native app on the iMac, gently: nice 15, 4 jobs, and not while
# the live app on 8737 plays or records. JUCE 9.0.5 and the build are on the
# 1 TB drive. Prints where the app is.
#
#   tools/app-on-imac.sh          build
#   tools/app-on-imac.sh --open   build, then open it
set -e -o pipefail
HERE=${0:A:h:h}
JUCE="/Volumes/1 TB Funtime/WORK DIR/tools/JUCE-9.0.5"
# One build folder per checkout: the main one's is app-imac; a worktree's is
# named after its branch, so sessions working at once never share a build.
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
BRANCH=$(git -C "$HERE" rev-parse --abbrev-ref HEAD | tr '/' '-')
if [[ $ROOT == "$HOME/Documents/MultiGrainLive" ]]; then
  BUILD="/Volumes/1 TB Funtime/WORK DIR/native-build/app-imac"
else
  BUILD="/Volumes/1 TB Funtime/WORK DIR/native-build/app-imac-$BRANCH"
fi

state=$(curl -s -m 5 localhost:8737/api/engine/state || true)
if [[ $state == *'"playing":true'* || $state == *'"capturing":true'* ]]; then
  echo "8737 is playing or recording: not now"; exit 1
fi

export CARGO_BUILD_JOBS=4
mkdir -p "$BUILD"
cd "$HERE/app"
[[ -f "$BUILD/CMakeCache.txt" ]] || nice -n 15 cmake -S . -B "$BUILD" -DJUCE_DIR="$JUCE" -DCMAKE_BUILD_TYPE=Release > "$BUILD/configure.log" 2>&1
nice -n 15 cmake --build "$BUILD" --config Release -j 4 > "$BUILD/build.log" 2>&1 || { grep -E '\berror\b' "$BUILD/build.log" | head -30; exit 1; }
APP="$BUILD/idMLab_artefacts/Release/idMLab.app"
echo "$APP"
[[ ${1:-} == --open ]] && open "$APP"
exit 0
