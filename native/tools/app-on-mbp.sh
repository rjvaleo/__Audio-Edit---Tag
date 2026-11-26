#!/bin/sh
# Build the native app on the MacBook (ssh mbp), so its snapshots and benches
# run there and not on the iMac (RJ, 18 Nov 2026: tests only on the laptop
# and the PC). Sends this folder and the crates it builds from as
# test-on-mbp.sh does, holds the MacBook's test lock while it builds, and
# prints where the app is there. With arguments, runs the app with them
# afterwards (still holding the lock), e.g.
#   tools/app-on-mbp.sh --snapshot seq-face /tmp/seq.png 2
# Its build folder is named after this checkout's branch.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$(cd "$HERE/.." && pwd)}"
BRANCH=$(git -C "$HERE" rev-parse --abbrev-ref HEAD | tr '/' '-')
R='~/idmlab-native'
B="$R/app-build-$BRANCH"
tar -C "$HERE" --exclude target --exclude build --exclude .git -cf - . | ssh mbp "mkdir -p $R/MultiGrainLive/native && cd $R/MultiGrainLive/native && rm -rf engine-core engine-capi engine-idmlab engine-mgl engine-app app && tar -x -f - -C ."
tar -C "$LAB/rust" --exclude target -cf - . | ssh mbp "rm -rf $R/GitHub/M\\ Clone/rust && mkdir -p $R/GitHub/M\\ Clone/rust && tar -x -f - -C $R/GitHub/M\\ Clone/rust"
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/GitHub/prism-fx && mkdir -p $R/GitHub/prism-fx && tar -x -f - -C $R/GitHub/prism-fx"
git -C "$MGL" archive --format=tar HEAD core ui/sequencer/presets.json | ssh mbp "rm -rf $R/MultiGrainLive/core && mkdir -p $R/MultiGrainLive && tar -x -f - -C $R/MultiGrainLive"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native app build (coordinator)' > ~/mgl-test/.lock/who"
# The MacBook's Command Line Tools look for libc++'s headers beside the
# compiler, where this install has none; the SDK has them.
ssh mbp "export PATH=\$HOME/.cargo/bin:/opt/homebrew/bin:\$PATH CARGO_BUILD_JOBS=6 CPLUS_INCLUDE_PATH=\$(xcrun --show-sdk-path)/usr/include/c++/v1; mkdir -p $B; cd $R/MultiGrainLive/native/app; [ -f $B/CMakeCache.txt ] || cmake -S . -B $B -DJUCE_DIR=\$HOME/idmlab-native/JUCE -DCMAKE_BUILD_TYPE=Release > $B/configure.log 2>&1; cmake --build $B --config Release -j 6 > $B/build.log 2>&1 || { grep -E '\\berror\\b' $B/build.log | head -30; exit 1; }; echo $B/idMLab_artefacts/Release/idMLab.app"
if [ $# -gt 0 ]; then
  ssh mbp "cd $R/MultiGrainLive/native && $B/idMLab_artefacts/Release/idMLab.app/Contents/MacOS/idMLab $*"
fi
