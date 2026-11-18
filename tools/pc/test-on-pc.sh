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
REV=$(git stash create)
[ -n "$REV" ] || REV=HEAD
Q='post-quantum|store now|be upgraded'
git archive --format=tar "$REV" -- . ':(exclude)Audio Library' \
  | ssh pc "(if not exist D:\\mgl-test\\MultiGrainLive mkdir D:\\mgl-test\\MultiGrainLive) & tar -x -f - -C D:/mgl-test/MultiGrainLive" 2>&1 | grep -Ev "$Q" || true
# The effects library the app builds against, a sibling as on this Mac
# (core/crates/fx: ../../../../GitHub/prism-fx), sent the same way.
FX=$(cd ../GitHub/prism-fx 2>/dev/null && pwd || echo "$HOME/Documents/GitHub/prism-fx")
FXREV=$(git -C "$FX" stash create)
[ -n "$FXREV" ] || FXREV=HEAD
git -C "$FX" archive --format=tar "$FXREV" \
  | ssh pc "(if not exist D:\\mgl-test\\GitHub\\prism-fx mkdir D:\\mgl-test\\GitHub\\prism-fx) & tar -x -f - -C D:/mgl-test/GitHub/prism-fx" 2>&1 | grep -Ev "$Q" || true
ssh pc "D:\\mgl-test\\MultiGrainLive\\tools\\pc\\run-tests.cmd $*" 2>&1 | grep -Ev "$Q"
