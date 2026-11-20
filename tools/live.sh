#!/bin/sh
# Restart the live app on 8737, with its output in one place RJ can watch.
#
#   tools/live.sh           restart it (from the main checkout's release build)
#   tools/live.sh --watch   follow the activity log
#   tools/live.sh --ui-from-disk
#                           restart it serving the interface from this checkout's
#                           ui/ folder: an interface change is then a reload, with
#                           no rebuild (AUDIOLAB_UI_DIR, routes/assets.rs). Only
#                           while working on the interface: whatever is in ui/,
#                           committed or not, is what the app shows.
#
# The output goes to data/logs/server.log, added to, never replaced, so every
# restart writes to the same file and `tail -f` on it never goes stale. (Each
# session used to start it with its own redirect, so the log was a different
# scratch file each time; RJ, 14 Nov 2026: "nothing showed up down there".)
# Only the process listening on 8737 is stopped, never anything by its path,
# so a test copy on another port carries on.

cd "$(dirname "$0")/.." || exit 1
LOG="$PWD/data/logs/server.log"
mkdir -p "$PWD/data/logs"

if [ "$1" = "--watch" ]; then
  touch "$LOG"
  exec tail -n 40 -F "$LOG"
fi

UI_DIR=
[ "$1" = "--ui-from-disk" ] && UI_DIR="$PWD/ui"

OLD=$(lsof -nP -iTCP:8737 -sTCP:LISTEN -t)
if [ -n "$OLD" ]; then
  kill $OLD
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    lsof -nP -iTCP:8737 -sTCP:LISTEN -t >/dev/null || break
    sleep 0.5
  done
fi
printf '\n──── %s  restarted (%s)%s ────\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(git log -1 --format='%h %s' 2>/dev/null)" "${UI_DIR:+, interface from ui/ on disk}" >> "$LOG"
# No new browser window: the app is already open where RJ uses it.
AUDIOLAB_UI_DIR="$UI_DIR" AUDIOLAB_NO_BROWSER=1 AUDIOLAB_DATA="$PWD/data" AUDIOLAB_PORT=8737 nohup ./core/target/release/audiolab >> "$LOG" 2>&1 < /dev/null &
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:8737/api/state && break
  sleep 1
done
NEW=$(lsof -nP -iTCP:8737 -sTCP:LISTEN -t)
if [ -z "$NEW" ]; then
  echo "8737 did not come up; see $LOG" >&2
  exit 1
fi
echo "8737 is up (pid $NEW); its log: $LOG"
