#!/bin/sh
# Build the JUCE probe on the PC (ssh pc, Windows) and run it there, on the
# PC's own sound card. Arguments go to the probe (--seconds, --monitor,
# --patch real, --engine 0..3); BUFFERS picks the buffer sizes (default 128).
# The result lines are kept in probe/results/pc-<date>.jsonl.
#
# What it uses on the PC: CMake in D:\tools (the portable zip from Kitware,
# installed 18 Nov 2026 on RJ's word), Visual Studio 2022 Build Tools'
# compiler, and a copy of the MacBook's JUCE (9.0.5) in D:\tools\JUCE-9.0.5,
# copied over the first time. The sources go where tools/test-on-pc.sh puts
# them, D:\mgl-test\idmlab-check.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LAB="${LAB:-$HOME/Documents/GitHub/M Clone}"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
MGL="${MGL:-$(cd "$HERE/.." && pwd)}"
MGL_REF="${MGL_REF:-main}"
Q='post-quantum|store now|be upgraded'
R='D:\\mgl-test\\idmlab-check'
U='D:/mgl-test/idmlab-check'
CMAKE='D:\\tools\\cmake-4.4.4-windows-x86_64\\bin\\cmake.exe'
JUCE='D:/tools/JUCE-9.0.5'
quiet() { grep -Ev "$Q" || true; }
fresh() { ssh pc "(if exist \"$R\\$1\" rmdir /s /q \"$R\\$1\") & mkdir \"$R\\$1\"" 2>&1 | quiet; }

if ! ssh pc "if exist D:\\tools\\JUCE-9.0.5\\CMakeLists.txt (exit 0) else (exit 1)" 2>/dev/null; then
  echo "copying JUCE from the MacBook"
  ssh pc "mkdir D:\\tools\\JUCE-9.0.5" 2>&1 | quiet
  ssh mbp "tar -C ~/idmlab-native/JUCE --exclude .git -cf - ." | ssh pc "tar -x -f - -C $JUCE" 2>&1 | quiet
fi

ssh pc "if not exist $R\\MultiGrainLive\\native mkdir $R\\MultiGrainLive\\native" 2>&1 | quiet
for part in engine-core engine-capi engine-idmlab engine-mgl probe\\Source; do
  ssh pc "if exist $R\\MultiGrainLive\\native\\$part rmdir /s /q $R\\MultiGrainLive\\native\\$part" 2>&1 | quiet
done
COPYFILE_DISABLE=1 tar -C "$HERE" --exclude target --exclude build --exclude .git --exclude results -cf - . \
  | ssh pc "tar -x -f - -C $U/MultiGrainLive/native" 2>&1 | quiet
fresh 'GitHub\\M Clone\\rust'
COPYFILE_DISABLE=1 tar -C "$LAB/rust" --exclude target -cf - . \
  | ssh pc "tar -x -f - -C \"$U/GitHub/M Clone/rust\"" 2>&1 | quiet
fresh 'GitHub\\prism-fx'
git -C "$FX" archive --format=tar HEAD | ssh pc "tar -x -f - -C $U/GitHub/prism-fx" 2>&1 | quiet
fresh 'MultiGrainLive\\core'
git -C "$MGL" archive --format=tar "$MGL_REF" core | ssh pc "tar -x -f - -C $U/MultiGrainLive" 2>&1 | quiet

ssh pc "cd /d $R\\MultiGrainLive\\native\\probe && (if not exist build\\CMakeCache.txt $CMAKE -S . -B build -G \"Visual Studio 17 2022\" -A x64 -DJUCE_DIR=$JUCE > configure.log 2>&1) && $CMAKE --build build --config Release -- /m /v:minimal > build.log 2>&1 & echo build exit %errorlevel% & findstr /i /c:\" error \" build.log configure.log" 2>&1 | quiet
EXE=$(ssh pc "cd /d $R\\MultiGrainLive\\native\\probe && dir /s /b build\\probe.exe" 2>&1 | quiet | grep -i 'probe.exe' | grep -i release | head -1 | tr -d '\r')
[ -n "$EXE" ] || { echo "no probe.exe was built; see $R\\MultiGrainLive\\native\\probe\\build.log"; exit 1; }
mkdir -p "$HERE/probe/results"
for BUFFER in ${BUFFERS:-128}; do
  ssh pc "\"$EXE\" --buffer $BUFFER $*" 2>&1 | quiet | tee -a "$HERE/probe/results/pc-$(date +%Y%m%d).jsonl"
done
