#!/bin/sh
# Build the phase 1 probe on the MacBook (ssh mbp) and run it there, holding
# the MacBook's test lock. Arguments go to the probe (--buffer, --seconds,
# --monitor). The result line is kept in probe/results/.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ssh mbp "mkdir -p ~/idmlab-native/native"
tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . | ssh mbp "rm -rf ~/idmlab-native/native/engine-core ~/idmlab-native/native/engine-capi ~/idmlab-native/native/probe/Source; tar -x -f - -C ~/idmlab-native/native"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'idmlab-native probe (coordinator)' > ~/mgl-test/.lock/who"
# The MacBook's command-line tools carry a stale, partial copy of the C++
# headers that hides the SDK's; point at the SDK's (see ../PHASE0.md).
ssh mbp 'zsh -lc "export PATH=\$HOME/.cargo/bin:\$PATH; export CXXFLAGS=\"-isystem \$(xcrun --show-sdk-path)/usr/include/c++/v1\"; cd ~/idmlab-native/native/probe && (test -f build/CMakeCache.txt || cmake -S . -B build -DJUCE_DIR=\$HOME/idmlab-native/JUCE -DCMAKE_BUILD_TYPE=Release > configure.log 2>&1) && cmake --build build --config Release -j 6 > build.log 2>&1; echo build exit \$?; grep -E \"error|warning: unused\" build.log | head -20"'
for BUFFER in ${BUFFERS:-128}; do
  ssh mbp "cd ~/idmlab-native/native/probe && \$(find build -type f -name probe -perm +111 | head -1) --buffer $BUFFER $*" | tee -a "$HERE/probe/results/mbp-$(date +%Y%m%d).jsonl"
done
