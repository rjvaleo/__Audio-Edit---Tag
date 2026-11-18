@echo off
rem The test suites on the PC (RJ, 17 Nov 2026: "use the PC controller to run
rem the tests"). Run by tools/pc/test-on-pc.sh after it has sent the code to
rem D:\mgl-test\MultiGrainLive (all of it on D:, RJ 17 Nov). Arguments are passed to
rem Playwright (test files, -g ...). Results: ..\results\ (last.json, last.log).
setlocal enabledelayedexpansion
set ROOT=D:\mgl-test
rem The build, the packages and the test browser on D: as well.
set CARGO_TARGET_DIR=%ROOT%\target
set PLAYWRIGHT_BROWSERS_PATH=%ROOT%\pw-browsers
set npm_config_cache=%ROOT%\npm-cache
set TEMP=%ROOT%\tmp
set TMP=%ROOT%\tmp
if not exist %ROOT%\tmp mkdir %ROOT%\tmp
set APP=%ROOT%\MultiGrainLive
if not exist %ROOT%\results mkdir %ROOT%\results
cd /d %APP%
if not exist %APP%\node_modules (call npm ci --no-audit --no-fund > %ROOT%\results\npm.log 2>&1)
if not exist %ROOT%\pw-browsers (call npx playwright install chromium > %ROOT%\results\pw.log 2>&1)
echo [%time%] build
cd core
cargo build --release -p audiolab -p fx-wasm 2> %ROOT%\results\build.log
if errorlevel 1 (echo build failed, see results\build.log & exit /b 1)
if "%1"=="rust" (
  echo [%time%] rust tests
  cargo test --release --no-fail-fast -p fx -p fx-wasm -p atmos -p server > %ROOT%\results\rust.log 2>&1
  set CODE=!errorlevel!
  findstr /c:"test result" /c:"FAILED" /c:"panicked" %ROOT%\results\rust.log
  exit /b !CODE!
)
cd /d %APP%
echo [%time%] browser tests
set PLAYWRIGHT_JSON_OUTPUT_NAME=%ROOT%\results\last.json
call npx playwright test %* --reporter=line,json
set CODE=%errorlevel%
echo [%time%] done %CODE%
exit /b %CODE%
