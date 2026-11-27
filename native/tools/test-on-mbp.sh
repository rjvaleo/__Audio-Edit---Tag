#!/bin/sh
# Send this folder to the MacBook (ssh mbp) and run the tests there, holding
# the MacBook's test lock (~/mgl-test/.lock) so nothing else runs beside it.
# Extra arguments go to `cargo test` (a test name, say).
#
# The crates this workspace builds from go beside it, laid out as they are in
# ~/Documents: GitHub/M Clone (idMLab's engine), GitHub/prism-fx and
# MultiGrainLive/core. Each is the committed code (idMLab's is the working
# folder), replaced whole on every run.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$(cd "$HERE/.." && pwd)}"
# Which of MGL's commits to build from: main, or a branch being tried, or
# WORKTREE for the folder MGL names as it stands (uncommitted edits to
# tracked or added files included).
MGL_REF="${MGL_REF:-main}"
case "$MGL_REF" in
  WORKTREE) MGL_REV=$(git -C "$MGL" stash create); [ -n "$MGL_REV" ] || MGL_REV=HEAD ;;
  *) MGL_REV="$MGL_REF" ;;
esac
R='~/idmlab-native'
# Files go by rsync, by content (-c) and without their times: what has not
# changed keeps its time there, so only what changed is rebuilt (and a branch
# older than the last build is still rebuilt where it differs). The committed
# crates go through a local copy of their commit on the 1 TB drive.
BRANCH=$(git -C "$HERE" rev-parse --abbrev-ref HEAD | tr '/' '-')
STAGE="/Volumes/1 TB Funtime/WORK DIR/native-build/stage-$BRANCH"
send() { rsync -rlc --delete --exclude target --exclude build --exclude .git --exclude .DS_Store "$@"; }
rm -rf "$STAGE/prism-fx.new" "$STAGE/mgl.new"; mkdir -p "$STAGE/prism-fx" "$STAGE/mgl" "$STAGE/prism-fx.new" "$STAGE/mgl.new"
git -C "$FX" archive --format=tar HEAD | tar -x -f - -C "$STAGE/prism-fx.new"
git -C "$MGL" archive --format=tar "$MGL_REV" core ui/sequencer/presets.json visualiser/grain-views.html visualiser/p5.min.js visualiser/fonts.css tools/pc/notes_basic_pitch.py | tar -x -f - -C "$STAGE/mgl.new"
rsync -rlc --delete "$STAGE/prism-fx.new/" "$STAGE/prism-fx/"
rsync -rlc --delete "$STAGE/mgl.new/" "$STAGE/mgl/"
rm -rf "$STAGE/prism-fx.new" "$STAGE/mgl.new"
# The folders of the first layout (copies, replaced by the ones under GitHub/).
ssh mbp "rm -rf $R/M\\ Clone $R/prism-fx; mkdir -p $R/MultiGrainLive/native $R/MultiGrainLive/core $R/GitHub/M\\ Clone/rust $R/GitHub/prism-fx"
send "$HERE/" "mbp:$R/MultiGrainLive/native/"
send "$LAB/rust/" "mbp:$R/GitHub/M\\ Clone/rust/"
send "$STAGE/prism-fx/" "mbp:$R/GitHub/prism-fx/"
send "$STAGE/mgl/core/" "mbp:$R/MultiGrainLive/core/"
# Seq's presets, which its test reads.
ssh mbp "mkdir -p $R/MultiGrainLive/ui/sequencer"
rsync -rlc "$STAGE/mgl/ui/sequencer/presets.json" "mbp:$R/MultiGrainLive/ui/sequencer/presets.json"
# What MGL's server crates build in from outside core (engine-library depends on them).
ssh mbp "mkdir -p $R/MultiGrainLive/visualiser"
rsync -rlc "$STAGE/mgl/visualiser/" "mbp:$R/MultiGrainLive/visualiser/"
ssh mbp "mkdir -p $R/MultiGrainLive/tools/pc"
rsync -rlc "$STAGE/mgl/tools/pc/notes_basic_pitch.py" "mbp:$R/MultiGrainLive/tools/pc/notes_basic_pitch.py"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native tests (coordinator)' > ~/mgl-test/.lock/who"
# Codex's shared cargo runs (~/mgl-test/.slots/<n>) never start while the
# lock is held, but one already running carries on: wait for those to end, so
# nothing builds beside a timing run.
ssh mbp 'until [ -z "$(for d in ~/mgl-test/.slots/*; do [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null && echo x; done)" ]; do sleep 10; done'
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH; cd $R/MultiGrainLive/native && cargo test --workspace --features engine-core/rt-check $* 2>&1"
