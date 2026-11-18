#!/bin/sh
# Send this folder to the PC (ssh pc, Windows) and run the tests there, in
# D:\mgl-test\idmlab-native. Extra arguments go to `cargo test`.
# Don't run it while a browser suite is on the PC: one test run at a time.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
Q='post-quantum|store now|be upgraded'
ssh pc "(if not exist D:\\mgl-test\\idmlab-native mkdir D:\\mgl-test\\idmlab-native)" 2>&1 | grep -Ev "$Q" || true
COPYFILE_DISABLE=1 tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . \
  | ssh pc "tar -x -f - -C D:/mgl-test/idmlab-native" 2>&1 | grep -Ev "$Q" || true
ssh pc "cd /d D:\\mgl-test\\idmlab-native && cargo test --workspace --features engine-core/rt-check $*" 2>&1 | grep -Ev "$Q"
