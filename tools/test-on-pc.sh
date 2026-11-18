#!/bin/sh
# Send this folder to the PC (ssh pc, Windows) and run the tests there, in
# D:\mgl-test\idmlab-check\native. idMLab's engine crate and prism-fx go
# beside it, where engine-idmlab looks for them. Extra arguments go to
# `cargo test`. Don't run it while a browser suite is on the PC: one test run
# at a time.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
Q='post-quantum|store now|be upgraded'
R='D:\\mgl-test\\idmlab-check'
ssh pc "(if not exist $R\\native mkdir $R\\native) & (if not exist \"$R\\M Clone\\rust\" mkdir \"$R\\M Clone\\rust\") & (if not exist $R\\prism-fx mkdir $R\\prism-fx)" 2>&1 | grep -Ev "$Q" || true
COPYFILE_DISABLE=1 tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . \
  | ssh pc "tar -x -f - -C D:/mgl-test/idmlab-check/native" 2>&1 | grep -Ev "$Q" || true
COPYFILE_DISABLE=1 tar -C "$LAB/rust" --exclude target -cf - . \
  | ssh pc "tar -x -f - -C \"D:/mgl-test/idmlab-check/M Clone/rust\"" 2>&1 | grep -Ev "$Q" || true
git -C "$FX" archive --format=tar HEAD \
  | ssh pc "tar -x -f - -C D:/mgl-test/idmlab-check/prism-fx" 2>&1 | grep -Ev "$Q" || true
ssh pc "cd /d $R\\native && cargo test --workspace --features engine-core/rt-check $*" 2>&1 | grep -Ev "$Q"
