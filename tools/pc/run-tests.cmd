@echo off
rem The test suites on the PC (RJ, 17 Nov 2026: "use the PC controller to run
rem the tests"). Run by tools/pc/test-on-pc.sh after it has sent the code to
rem D:\mgl-test\MultiGrainLive (all of it on D:, RJ 17 Nov). Arguments are passed to
rem Playwright (test files, -g ...). Results: ..\results\ (last.json, last.log),
rem and each run's own folder in ..\results\runs\, which the PC Controller's Tests page reads.
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
rem The run's record, for the PC Controller's Tests page (tools\pc\run-log.mjs).
node tools\pc\run-log.mjs start %*
if errorlevel 3 exit /b 3
set /p MGL_RUN_DIR=<%ROOT%\results\current.txt
if not exist %APP%\node_modules (call npm ci --no-audit --no-fund > %ROOT%\results\npm.log 2>&1)
if not exist %ROOT%\pw-browsers (call npx playwright install chromium > %ROOT%\results\pw.log 2>&1)
echo [%time%] build
cd core
cargo build --release -p audiolab -p fx-wasm 2> %ROOT%\results\build.log
if errorlevel 1 (echo build failed, see results\build.log & node %APP%\tools\pc\run-log.mjs end 1 & exit /b 1)
node %APP%\tools\pc\run-log.mjs phase tests
if "%1"=="rust" (
  echo [%time%] rust tests
  rem Into the run's own folder, then where it has always been: two runs once shared results\rust.log.
  cargo test --release --no-fail-fast -p fx -p fx-wasm -p atmos -p songprint -p server > !MGL_RUN_DIR!\rust.log 2>&1
  set CODE=!errorlevel!
  copy /y !MGL_RUN_DIR!\rust.log %ROOT%\results\rust.log > nul
  findstr /c:"test result" /c:"FAILED" /c:"panicked" %ROOT%\results\rust.log
  node %APP%\tools\pc\run-log.mjs end !CODE!
  exit /b !CODE!
)
cd /d %APP%
echo [%time%] browser tests
set PLAYWRIGHT_JSON_OUTPUT_NAME=%ROOT%\results\last.json
call npx playwright test %* --reporter=line,json,./tools/pc/progress-reporter.mjs
set CODE=%errorlevel%
node tools\pc\run-log.mjs end %CODE%
echo [%time%] done %CODE%
exit /b %CODE%
