#!/bin/sh
# Send this folder to the MacBook (ssh mbp) and run the tests there, holding
# the MacBook's test lock (~/mgl-test/.lock) so nothing else runs beside it.
# Extra arguments go to `cargo test` (a test name, say).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ssh mbp "mkdir -p ~/idmlab-native/native"
tar -C "$HERE" --exclude target --exclude build --exclude .git -cf - . | ssh mbp "rm -rf ~/idmlab-native/native/engine-core ~/idmlab-native/native/engine-capi; tar -x -f - -C ~/idmlab-native/native"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native tests (coordinator)' > ~/mgl-test/.lock/who"
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH; cd ~/idmlab-native/native && cargo test --workspace --features engine-core/rt-check $* 2>&1"
