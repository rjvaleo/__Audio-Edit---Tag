#!/bin/sh
# Build the probe on the MacBook (ssh mbp) and run it there, holding the
# MacBook's test lock. Arguments go to the probe (--seconds, --monitor,
# --patch real, --engine 0..3). The result line is kept in probe/results/.
# The real patch builds MGL's crates, which the test scripts leave beside
# this folder on the MacBook: run tools/test-on-mbp.sh once first.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ssh mbp "mkdir -p ~/idmlab-native/native"
tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . | ssh mbp "rm -rf ~/idmlab-native/native/engine-core ~/idmlab-native/native/engine-capi ~/idmlab-native/native/engine-idmlab ~/idmlab-native/native/engine-mgl ~/idmlab-native/native/probe/Source; tar -x -f - -C ~/idmlab-native/native"
# git archive dates every file at its commit; a branch older than the last
# build in the same build folder would then reuse that build. Touch it all.
ssh mbp "find ~/idmlab-native/native ~/idmlab-native/GitHub ~/idmlab-native/MultiGrainLive ~/idmlab-native/pg-check ~/idmlab-native/wsola-trial -type f -not -path '*/target/*' -not -path '*/build/*' -exec touch {} + 2>/dev/null; true"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native probe (coordinator)' > ~/mgl-test/.lock/who"
# Codex's shared cargo runs (~/mgl-test/.slots/<n>) never start while the
# lock is held, but one already running carries on: wait for those to end, so
# nothing builds beside a timing run.
ssh mbp 'until [ -z "$(for d in ~/mgl-test/.slots/*; do [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null && echo x; done)" ]; do sleep 10; done'
# The MacBook's command-line tools carry a stale, partial copy of the C++
# headers that hides the SDK's; point at the SDK's (see ../PHASE0.md).
ssh mbp 'zsh -lc "export PATH=\$HOME/.cargo/bin:\$PATH; export CXXFLAGS=\"-isystem \$(xcrun --show-sdk-path)/usr/include/c++/v1\"; cd ~/idmlab-native/native/probe && (test -f build/CMakeCache.txt || cmake -S . -B build -DJUCE_DIR=\$HOME/idmlab-native/JUCE -DCMAKE_BUILD_TYPE=Release > configure.log 2>&1) && cmake --build build --config Release -j 6 > build.log 2>&1; echo build exit \$?; grep -E \"error|warning: unused\" build.log | head -20"'
for BUFFER in ${BUFFERS:-128}; do
  ssh mbp "cd ~/idmlab-native/native/probe && \$(find build -type f -name probe -perm +111 | head -1) --buffer $BUFFER $*" | tee -a "$HERE/probe/results/mbp-$(date +%Y%m%d).jsonl"
done
