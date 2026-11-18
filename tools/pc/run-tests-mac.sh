#!/bin/zsh
# The test suites on a second Mac (the MacBook Pro), run by test-on-mbp.sh.
# Results: ~/mgl-test/results (build.log, rust.log, last.json).
R=$HOME/mgl-test
export PATH=$R/tools/node/bin:$HOME/.cargo/bin:$PATH
export CARGO_TARGET_DIR=$R/target
cd $R/MultiGrainLive
[ -d node_modules ] || npm ci --no-audit --no-fund > $R/results/npm.log 2>&1
[ -d "$HOME/Library/Caches/ms-playwright" ] || npx playwright install chromium > $R/results/pw.log 2>&1
echo "[$(date +%T)] build"
(cd core && cargo build --release -p audiolab -p fx-wasm 2> $R/results/build.log) || { echo "build failed, see results/build.log"; tail -20 $R/results/build.log; exit 1; }
if [ "$1" = rust ]; then
  echo "[$(date +%T)] rust tests"
  (cd core && cargo test --release --no-fail-fast -p fx -p fx-wasm -p atmos -p songprint -p server > $R/results/rust.log 2>&1); code=$?
  grep -E "test result|FAILED|panicked" $R/results/rust.log | sort | uniq -c
  exit $code
fi
echo "[$(date +%T)] browser tests"
PLAYWRIGHT_JSON_OUTPUT_NAME=$R/results/last.json npx playwright test "$@" --reporter=line,json
code=$?
echo "[$(date +%T)] done $code"
exit $code
