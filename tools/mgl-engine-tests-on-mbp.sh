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
R='~/idmlab-native'
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/GitHub/prism-fx && mkdir -p $R/GitHub/prism-fx && tar -x -f - -C $R/GitHub/prism-fx"
git -C "$MGL" archive --format=tar "$MGL_REF" core | ssh mbp "rm -rf $R/MultiGrainLive && mkdir -p $R/MultiGrainLive && tar -x -f - -C $R/MultiGrainLive"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'MGL engine tests (coordinator)' > ~/mgl-test/.lock/who"
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH CARGO_TARGET_DIR=\$HOME/idmlab-native/mgl-target; cd $R/MultiGrainLive/core && cargo test --release -p engine --no-fail-fast $* 2>&1; echo \"tests exit \$?\"; cargo check --release -p engine --no-default-features 2>&1 | tail -3; echo \"no-device check exit \$?\""
