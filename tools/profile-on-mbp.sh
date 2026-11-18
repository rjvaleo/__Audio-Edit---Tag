#!/bin/sh
# Where the time goes: run one of the `profile_*` measurements in
# engine-mgl/tests/cost.rs on the MacBook (ssh mbp), in a release build,
# under macOS's `sample`, and print the functions the samples landed in.
#   tools/profile-on-mbp.sh profile_wave_32
# MGL_REF and FX choose which MultiGrainLive and prism-fx to build from, as
# for test-on-mbp.sh. It holds the MacBook's test lock.
set -e
NAME="${1:?which measurement, e.g. profile_wave_32}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$HOME/Documents/MultiGrainLive}"
MGL_REF="${MGL_REF:-main}"
case "$MGL_REF" in
  WORKTREE) MGL_REV=$(git -C "$MGL" stash create); [ -n "$MGL_REV" ] || MGL_REV=HEAD ;;
  *) MGL_REV="$MGL_REF" ;;
esac
R='~/idmlab-native'
tar -C "$HERE" --exclude target --exclude build --exclude .git -cf - . | ssh mbp "cd $R/native && rm -rf engine-core engine-capi engine-idmlab engine-mgl && tar -x -f - -C ."
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $R/GitHub/prism-fx && mkdir -p $R/GitHub/prism-fx && tar -x -f - -C $R/GitHub/prism-fx"
git -C "$MGL" archive --format=tar "$MGL_REV" core | ssh mbp "rm -rf $R/MultiGrainLive && mkdir -p $R/MultiGrainLive && tar -x -f - -C $R/MultiGrainLive"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native profile (coordinator)' > ~/mgl-test/.lock/who"
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH; cd $R/native && cargo test --release -p engine-mgl --test cost --no-run 2>&1 | tail -2; BIN=\$(ls -t target/release/deps/cost-* | grep -v '\\.d\$' | head -1); (PROFILE_SECONDS=10 \$BIN --ignored --exact $NAME --nocapture > /tmp/profile-run.txt 2>&1 &) ; sleep 2; PID=\$(pgrep -f 'deps/cost-' | head -1); sample \$PID 6 -mayDie -file /tmp/profile-sample.txt > /dev/null 2>&1; sleep 4; grep 'times real time' /tmp/profile-run.txt; awk '/Sort by top of stack/{f=1;next} f&&NF' /tmp/profile-sample.txt | head -${TOP:-28}"
