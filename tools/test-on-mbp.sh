#!/bin/sh
# Send this folder to the MacBook (ssh mbp) and run the tests there, holding
# the MacBook's test lock (~/mgl-test/.lock) so nothing else runs beside it.
# Extra arguments go to `cargo test` (a test name, say).
#
# The crates this workspace builds from go beside it, laid out as they are in
# ~/Documents: GitHub/M Clone (idMLab's engine), GitHub/prism-fx and
# MultiGrainLive/core. Each is the committed code (idMLab's is the working
# folder), replaced whole on every run.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$HOME/Documents/MultiGrainLive}"
R='~/idmlab-native'
# The folders of the first layout (copies, replaced by the ones under GitHub/).
ssh mbp "rm -rf $R/M\\ Clone $R/prism-fx; mkdir -p $R/native"
tar -C "$HERE" --exclude target --exclude build --exclude .git -cf - . | ssh mbp "cd $R/native && rm -rf engine-core engine-capi engine-idmlab engine-mgl && tar -x -f - -C ."
tar -C "$LAB/rust" --exclude target -cf - . | ssh mbp "rm -rf $R/GitHub/M\\ Clone/rust && mkdir -p $R/GitHub/M\\ Clone/rust && tar -x -f - -C $R/GitHub/M\\ Clone/rust"
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/GitHub/prism-fx && mkdir -p $R/GitHub/prism-fx && tar -x -f - -C $R/GitHub/prism-fx"
git -C "$MGL" archive --format=tar main core | ssh mbp "rm -rf $R/MultiGrainLive && mkdir -p $R/MultiGrainLive && tar -x -f - -C $R/MultiGrainLive"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native tests (coordinator)' > ~/mgl-test/.lock/who"
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH; cd $R/native && cargo test --workspace --features engine-core/rt-check $* 2>&1"
