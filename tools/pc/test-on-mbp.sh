#!/bin/sh
# Run the test suites on the MacBook Pro (M1 Pro, 16 GB; RJ, 17 Nov 2026: "loop
# it in, put it to work"), on its internal drive, ~/mgl-test.
#
#   tools/pc/test-on-mbp.sh tests/ui/sequencer-atfx.spec.mjs   browser tests
#   tools/pc/test-on-mbp.sh rust                                Rust tests
#
# Sends the working tree as it is (through `git stash create`), new files not
# yet added included, without `Audio Library`, and prism-fx beside it as on this
# Mac, then builds and runs there. ssh host `mbp` (RJs-MacBook-Pro.local, in
# ~/.ssh/config).
#
# **Synced, not unpacked over the last one.** `git archive` stamps every file
# with its commit's time, so a tree from an older commit looked older than the
# build already in ~/mgl-test/target and cargo kept that build: main ran on the
# stems branch's `fx` (17 Nov). And files another tree left behind stayed. So
# the tree is unpacked here and synced by checksum, with --delete: only what
# changed is sent, it lands with the time it arrived, and nothing is left over.
set -e
cd "$(dirname "$0")/../.."
# **One job at a time on the MacBook.** Two sessions sending at once unpacked
# one tree over the other and built in the same target (17 Nov). The lock is a
# folder there, with who holds it; a job that dies leaves it, and says so.
ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null" || { echo "the MacBook is busy: $(ssh mbp 'cat ~/mgl-test/.lock/who 2>/dev/null; stat -f "since %Sm" ~/mgl-test/.lock') (remove ~/mgl-test/.lock on it if that job is dead)"; exit 1; }
X=$(mktemp -d "${TMPDIR:-/tmp}/mgl-mbp.XXXXXX")
trap 'rm -rf "$X"; ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
trap 'exit 1' INT TERM HUP
ssh mbp "echo '$(pwd) $*' > ~/mgl-test/.lock/who"
mkdir -p "$X/MultiGrainLive" "$X/prism-fx"
REV=$(git stash create); [ -n "$REV" ] || REV=HEAD
git archive --format=tar "$REV" -- . ':(exclude)Audio Library' | tar -x -f - -C "$X/MultiGrainLive"
git ls-files -z --others --exclude-standard -- . ':(exclude)Audio Library' ':(exclude).claude' | tar -c --null -T - -f - | tar -x -f - -C "$X/MultiGrainLive"
FX=$(cd ../GitHub/prism-fx 2>/dev/null && pwd || echo "$HOME/Documents/GitHub/prism-fx")
FXREV=$(git -C "$FX" stash create); [ -n "$FXREV" ] || FXREV=HEAD
git -C "$FX" archive --format=tar "$FXREV" | tar -x -f - -C "$X/prism-fx"
ssh mbp "mkdir -p ~/mgl-test/MultiGrainLive ~/mgl-test/GitHub/prism-fx ~/mgl-test/results; rm -rf ~/mgl-test/MultiGrainLive/test-results"
rsync -rlc --delete --exclude node_modules --exclude test-results "$X/MultiGrainLive/" mbp:mgl-test/MultiGrainLive/
rsync -rlc --delete "$X/prism-fx/" mbp:mgl-test/GitHub/prism-fx/
# Settings that choose what runs, carried over (ssh passes no environment).
ENVS=""
[ -n "$REFERENCE_RENDERS" ] && ENVS="REFERENCE_RENDERS='$REFERENCE_RENDERS' "
[ -n "$TEST_MAP_OUT" ] && ENVS="${ENVS}TEST_MAP_OUT='$TEST_MAP_OUT' "
ssh mbp "${ENVS}zsh ~/mgl-test/MultiGrainLive/tools/pc/run-tests-mac.sh $*"
