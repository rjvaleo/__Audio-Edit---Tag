#!/bin/sh
# Send this folder to the PC (ssh pc, Windows) and run the tests there, in
# D:\mgl-test\idmlab-check\native. Extra arguments go to `cargo test`. Don't
# run it while a browser suite is on the PC: one test run at a time.
#
# The crates this workspace builds from go beside it, laid out as they are in
# ~/Documents: GitHub\M Clone (idMLab's engine), GitHub\prism-fx and
# MultiGrainLive\core. Each is the committed code (idMLab's is the working
# folder), replaced whole on every run.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$HOME/Documents/MultiGrainLive}"
# Which of MGL's commits to build from: main, or a branch being tried.
MGL_REF="${MGL_REF:-main}"
Q='post-quantum|store now|be upgraded'
R='D:\\mgl-test\\idmlab-check'
U='D:/mgl-test/idmlab-check'
quiet() { grep -Ev "$Q" || true; }
fresh() { ssh pc "(if exist \"$R\\$1\" rmdir /s /q \"$R\\$1\") & mkdir \"$R\\$1\"" 2>&1 | quiet; }
# The folders of the first layout (copies, replaced by the ones under GitHub\).
ssh pc "(if exist \"$R\\M Clone\" rmdir /s /q \"$R\\M Clone\") & (if exist $R\\prism-fx rmdir /s /q $R\\prism-fx) & (if not exist $R\\native mkdir $R\\native)" 2>&1 | quiet
for crate in engine-core engine-capi engine-idmlab engine-mgl; do
  ssh pc "if exist $R\\native\\$crate rmdir /s /q $R\\native\\$crate" 2>&1 | quiet
done
COPYFILE_DISABLE=1 tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . \
  | ssh pc "tar -x -f - -C $U/native" 2>&1 | quiet
fresh 'GitHub\\M Clone\\rust'
COPYFILE_DISABLE=1 tar -C "$LAB/rust" --exclude target -cf - . \
  | ssh pc "tar -x -f - -C \"$U/GitHub/M Clone/rust\"" 2>&1 | quiet
fresh 'GitHub\\prism-fx'
git -C "$FX" archive --format=tar HEAD | ssh pc "tar -x -f - -C $U/GitHub/prism-fx" 2>&1 | quiet
fresh 'MultiGrainLive'
git -C "$MGL" archive --format=tar "$MGL_REF" core | ssh pc "tar -x -f - -C $U/MultiGrainLive" 2>&1 | quiet
ssh pc "cd /d $R\\native && cargo test --workspace --features engine-core/rt-check $*" 2>&1 | grep -Ev "$Q"
