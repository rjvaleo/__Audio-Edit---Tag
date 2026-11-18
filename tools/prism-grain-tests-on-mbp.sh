#!/bin/sh
# prism-grain's own tests on the MacBook (ssh mbp), from the prism-fx folder
# FX names (default: the main checkout), as committed there.
# Extra arguments go to `cargo test`.
set -e
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
R='~/idmlab-native'
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/pg-check && mkdir -p $R/pg-check && tar -x -f - -C $R/pg-check"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'prism-grain tests (coordinator)' > ~/mgl-test/.lock/who"
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH CARGO_TARGET_DIR=\$HOME/idmlab-native/pg-target; cd $R/pg-check && cargo test --release -p prism-grain --no-fail-fast $* 2>&1"
