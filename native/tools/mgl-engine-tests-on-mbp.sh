#!/bin/sh
# MultiGrainLive's own engine tests on the MacBook (ssh mbp), for a change to
# MGL's engine crate: its golden hashes are Apple silicon's, and the PC's
# Rust run (MGL's tools/pc/test-on-pc.sh rust) leaves the engine crate out.
# Builds MGL_REF (default main) with the sound card code, runs the engine
# crate's tests, then checks the crate still builds without it.
# Extra arguments go to `cargo test`.
set -e
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$HOME/Documents/MultiGrainLive}"
MGL_REF="${MGL_REF:-main}"
# MGL_REF=WORKTREE: the folder MGL names as it stands, uncommitted edits to
# tracked or added files included.
case "$MGL_REF" in
  WORKTREE) MGL_REV=$(git -C "$MGL" stash create); [ -n "$MGL_REV" ] || MGL_REV=HEAD ;;
  *) MGL_REV="$MGL_REF" ;;
esac
R='~/idmlab-native'
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/GitHub/prism-fx && mkdir -p $R/GitHub/prism-fx && tar -x -f - -C $R/GitHub/prism-fx"
# The whole tree but the sound library: the server crate embeds the interface,
# the visualiser and a tool at build time.
git -C "$MGL" archive --format=tar "$MGL_REV" -- . ':(exclude)Audio Library' | ssh mbp "rm -rf $R/MultiGrainLive && mkdir -p $R/MultiGrainLive && tar -x -f - -C $R/MultiGrainLive"
# git archive dates every file at its commit; a branch older than the last
# build in the same build folder would then reuse that build. Touch it all.
ssh mbp "find ~/idmlab-native/native ~/idmlab-native/GitHub ~/idmlab-native/MultiGrainLive ~/idmlab-native/pg-check ~/idmlab-native/wsola-trial -type f -not -path '*/target/*' -not -path '*/build/*' -exec touch {} + 2>/dev/null; true"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'MGL engine tests (coordinator)' > ~/mgl-test/.lock/who"
# Codex's shared cargo runs (~/mgl-test/.slots/<n>) never start while the
# lock is held, but one already running carries on: wait for those to end, so
# nothing builds beside a timing run.
ssh mbp 'until [ -z "$(for d in ~/mgl-test/.slots/*; do [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null && echo x; done)" ]; do sleep 10; done'
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH CARGO_TARGET_DIR=\$HOME/idmlab-native/mgl-target; cd $R/MultiGrainLive/core && cargo test --release -p engine --no-fail-fast $* 2>&1; echo \"tests exit \$?\"; cargo check --release -p engine --no-default-features 2>&1 | tail -3; echo \"no-device check exit \$?\""
