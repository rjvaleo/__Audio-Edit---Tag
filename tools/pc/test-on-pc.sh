#!/bin/sh
# Run the test suites on the PC instead of this Mac (RJ, 17 Nov 2026).
#
#   tools/pc/test-on-pc.sh tests/ui/sequencer-atfx.spec.mjs   browser tests
#   tools/pc/test-on-pc.sh rust                                Rust tests
#
# Sends the working tree as it is (uncommitted edits included, through
# `git stash create`) to D:\mgl-test\MultiGrainLive (everything on D:),
# without `Audio Library` (some of its names are not allowed on Windows and no
# test reads it), then runs tools/pc/run-tests.cmd there.
set -e
cd "$(dirname "$0")/../.."
Q='post-quantum|store now|be upgraded'
# **One run at a time on the PC.** A second one unpacks its code over the first's
# and builds in the same folder (18 Nov 2026). The PC's own record says if one is going.
BUSY=$(ssh pc "if exist D:\\mgl-test\\MultiGrainLive\\tools\\pc\\run-log.mjs node D:\\mgl-test\\MultiGrainLive\\tools\\pc\\run-log.mjs busy" 2>&1 | grep -Ev "$Q" || true)
case "$BUSY" in busy:*) echo "$BUSY"; exit 1;; esac
REV=$(git stash create)
[ -n "$REV" ] || REV=HEAD
# The Rust tree unpacked fresh, not over the last one: a moved or deleted file
# stays behind otherwise, and a `build.rs` left in a crate's folder is still that
# crate's build script (the server split, 20 Nov 2026). The build itself is in
# D:\mgl-test\target and is kept.
ssh pc "if exist D:\\mgl-test\\MultiGrainLive\\core rmdir /s /q D:\\mgl-test\\MultiGrainLive\\core" 2>&1 | grep -Ev "$Q" || true
git archive --format=tar "$REV" -- . ':(exclude)Audio Library' \
  | ssh pc "(if not exist D:\\mgl-test\\MultiGrainLive mkdir D:\\mgl-test\\MultiGrainLive) & tar -x -f - -C D:/mgl-test/MultiGrainLive" 2>&1 | grep -Ev "$Q" || true
# The effects library the app builds against, a sibling as on this Mac
# (core/crates/fx: ../../../../GitHub/prism-fx), sent the same way.
FX=$(cd ../GitHub/prism-fx 2>/dev/null && pwd || echo "$HOME/Documents/GitHub/prism-fx")
FXREV=$(git -C "$FX" stash create)
[ -n "$FXREV" ] || FXREV=HEAD
git -C "$FX" archive --format=tar "$FXREV" \
  | ssh pc "(if not exist D:\\mgl-test\\GitHub\\prism-fx mkdir D:\\mgl-test\\GitHub\\prism-fx) & tar -x -f - -C D:/mgl-test/GitHub/prism-fx" 2>&1 | grep -Ev "$Q" || true
# Which code that was, for the PC Controller's Tests page.
S=$(mktemp)
printf '{"commit":"%s","branch":"%s","dirty":%s,"when":"%s"}\n' "$(git rev-parse --short HEAD)" "$(git rev-parse --abbrev-ref HEAD)" "$([ "$REV" = HEAD ] && echo false || echo true)" "$(date -u +%FT%TZ)" > "$S"
ssh pc "if not exist D:\\mgl-test\\results mkdir D:\\mgl-test\\results" 2>&1 | grep -Ev "$Q" || true
scp -q "$S" pc:D:/mgl-test/results/sent.json 2>&1 | grep -Ev "$Q" || true
rm -f "$S"
# The run's own exit code, not grep's: a failed run once left this script saying 0.
C=$(mktemp)
{ ssh pc "D:\\mgl-test\\MultiGrainLive\\tools\\pc\\run-tests.cmd $*" 2>&1; echo $? > "$C"; } | grep -Ev "$Q" || true
CODE=$(cat "$C"); rm -f "$C"
exit "${CODE:-1}"
