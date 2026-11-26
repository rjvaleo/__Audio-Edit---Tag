#!/bin/sh
# Build the native app on the MacBook (ssh mbp), so the iMac stays free, and
# bring it back to run on the iMac (RJ, 26 Nov 2026: the laptop and the PC do
# the work; the iMac is where he uses it). Holds the MacBook's test lock while
# it builds and prints where the app is.
#
#   tools/app-on-mbp.sh            build there
#   tools/app-on-mbp.sh --open     build there, copy it to the iMac, open it
#   tools/app-on-mbp.sh --snapshot seq-face /tmp/seq.png 2
#                                  build there, run it there with these
#
# Files go by rsync, by content (-c) and without their times, so what has not
# changed keeps its time on the MacBook and only what has is rebuilt. The
# app is built for macOS 26.0 and later, so the iMac (26.6) runs it. Its build
# folder there is named after this checkout's branch; the copy here goes in
# WORK DIR/native-build/app-mbp-<branch> (the 1 TB drive, not the internal one).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$(cd "$HERE/.." && pwd)}"
BRANCH=$(git -C "$HERE" rev-parse --abbrev-ref HEAD | tr '/' '-')
R='~/idmlab-native'
B="$R/app-build-$BRANCH"
OUT="/Volumes/1 TB Funtime/WORK DIR/native-build/app-mbp-$BRANCH"
STAGE="/Volumes/1 TB Funtime/WORK DIR/native-build/stage-$BRANCH"
MINOS=26.0
send() { rsync -rlc --delete --exclude target --exclude build --exclude .git --exclude .DS_Store "$@"; }

# The committed crates (prism-fx, MGL's core and Seq's presets) go through a
# local copy of their commit, so rsync sends only what changed.
mkdir -p "$STAGE/prism-fx" "$STAGE/mgl"
rm -rf "$STAGE/prism-fx.new" "$STAGE/mgl.new"; mkdir -p "$STAGE/prism-fx.new" "$STAGE/mgl.new"
git -C "$FX" archive --format=tar HEAD | tar -x -f - -C "$STAGE/prism-fx.new"
git -C "$MGL" archive --format=tar HEAD core ui/sequencer/presets.json | tar -x -f - -C "$STAGE/mgl.new"
rsync -rlc --delete "$STAGE/prism-fx.new/" "$STAGE/prism-fx/"
rsync -rlc --delete "$STAGE/mgl.new/" "$STAGE/mgl/"
rm -rf "$STAGE/prism-fx.new" "$STAGE/mgl.new"

ssh mbp "mkdir -p $R/MultiGrainLive/native $R/GitHub/M\\ Clone/rust $R/GitHub/prism-fx"
send "$HERE/" "mbp:$R/MultiGrainLive/native/"
send "$LAB/rust/" "mbp:$R/GitHub/M\\ Clone/rust/"
send "$STAGE/prism-fx/" "mbp:$R/GitHub/prism-fx/"
send "$STAGE/mgl/core/" "mbp:$R/MultiGrainLive/core/"
ssh mbp "mkdir -p $R/MultiGrainLive/ui/sequencer"
rsync -rlc "$STAGE/mgl/ui/sequencer/presets.json" "mbp:$R/MultiGrainLive/ui/sequencer/presets.json"

until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native app build (coordinator)' > ~/mgl-test/.lock/who"
# The MacBook's Command Line Tools look for libc++'s headers beside the
# compiler, where this install has none; the SDK has them.
ssh mbp "export PATH=\$HOME/.cargo/bin:/opt/homebrew/bin:\$PATH CARGO_BUILD_JOBS=6 MACOSX_DEPLOYMENT_TARGET=$MINOS CPLUS_INCLUDE_PATH=\$(xcrun --show-sdk-path)/usr/include/c++/v1; mkdir -p $B; cd $R/MultiGrainLive/native/app; cmake -S . -B $B -DJUCE_DIR=\$HOME/idmlab-native/JUCE -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=$MINOS > $B/configure.log 2>&1 || { tail -20 $B/configure.log; exit 1; }; cmake --build $B --config Release -j 6 > $B/build.log 2>&1 || { grep -E '\\berror\\b' $B/build.log | head -30; exit 1; }; echo built: $B/idMLab_artefacts/Release/idMLab.app"

case "${1:-}" in
  --open)
    mkdir -p "$OUT"
    rsync -a --delete "mbp:$B/idMLab_artefacts/Release/idMLab.app/" "$OUT/idMLab.app/"
    echo "$OUT/idMLab.app"
    open "$OUT/idMLab.app" ;;
  "") ;;
  *) ssh mbp "cd $R/MultiGrainLive/native && $B/idMLab_artefacts/Release/idMLab.app/Contents/MacOS/idMLab $*" ;;
esac
