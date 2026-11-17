#!/bin/sh
# Run the test suites on the MacBook Pro (M1 Pro, 16 GB; RJ, 17 Nov 2026: "loop
# it in, put it to work"), on its internal drive, ~/mgl-test.
#
#   tools/pc/test-on-mbp.sh tests/ui/sequencer-atfx.spec.mjs   browser tests
#   tools/pc/test-on-mbp.sh rust                                Rust tests
#
# Sends the working tree as it is (through `git stash create`), without
# `Audio Library`, and prism-fx beside it as on this Mac, then builds and runs
# there. ssh host `mbp` (RJs-MacBook-Pro.local, in ~/.ssh/config).
set -e
cd "$(dirname "$0")/../.."
REV=$(git stash create); [ -n "$REV" ] || REV=HEAD
FX=$(cd ../GitHub/prism-fx 2>/dev/null && pwd || echo "$HOME/Documents/GitHub/prism-fx")
FXREV=$(git -C "$FX" stash create); [ -n "$FXREV" ] || FXREV=HEAD
ssh mbp "mkdir -p ~/mgl-test/MultiGrainLive ~/mgl-test/GitHub/prism-fx ~/mgl-test/results"
git archive --format=tar "$REV" -- . ':(exclude)Audio Library' | ssh mbp "tar -x -f - -C ~/mgl-test/MultiGrainLive"
git -C "$FX" archive --format=tar "$FXREV" | ssh mbp "tar -x -f - -C ~/mgl-test/GitHub/prism-fx"
ssh mbp "zsh ~/mgl-test/MultiGrainLive/tools/pc/run-tests-mac.sh $*"
