#!/bin/sh
# The WSOLA eight-chain trial on the MacBook (ssh mbp): renders of real
# recordings before (prism-fx BEFORE, default main) and after (the committed
# HEAD of FX), a comparison of the two, and a count of how often the splice
# search picks differently. Holds the MacBook's test lock.
#
#   SONGS="a.wav;b.aif" sh tools/wsola-trial-on-mbp.sh
#
# The songs are copied over once and turned into 48 kHz 32-bit float WAV
# with afconvert. The renders come back to WORK DIR/idmlab-move/wsola-trial.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FX="${FX:-$HOME/Documents/GitHub/prism-fx}"
BEFORE="${BEFORE:-main}"
BACK="${BACK:-$HERE/../wsola-trial}"
R='~/idmlab-native'
T="$R/wsola-trial"
ssh mbp "mkdir -p $T/songs"
LIST=""
OLDIFS="$IFS"; IFS=';'
for song in $SONGS; do
  IFS="$OLDIFS"
  base=$(basename "$song"); stem="${base%.*}"; stem=$(printf '%s' "$stem" | tr ' ' '-')
  if ! ssh mbp "test -f $T/songs/$stem.wav"; then
    scp -q "$song" "mbp:idmlab-native/wsola-trial/songs/source-$stem.${base##*.}"
    ssh mbp "cd $T/songs && afconvert -f WAVE -d LEF32@48000 source-$stem.${base##*.} $stem.wav && rm source-$stem.${base##*.}"
  fi
  LIST="$LIST\$HOME/idmlab-native/wsola-trial/songs/$stem.wav;"
  IFS=';'
done
IFS="$OLDIFS"
git -C "$FX" archive --format=tar "$BEFORE" | ssh mbp "rm -rf $T/before && mkdir -p $T/before && tar -x -f - -C $T/before"
git -C "$FX" archive --format=tar HEAD | ssh mbp "rm -rf $T/after && mkdir -p $T/after && tar -x -f - -C $T/after"
# The before build gets the trial's render test too; nothing else of the after one.
ssh mbp "cp $T/after/crates/prism-grain/tests/wsola_trial.rs $T/before/crates/prism-grain/tests/"
until ssh mbp "mkdir ~/mgl-test/.lock 2>/dev/null"; do sleep 20; done
trap 'ssh mbp "rm -rf ~/mgl-test/.lock"' EXIT
ssh mbp "echo 'WSOLA trial renders (coordinator)' > ~/mgl-test/.lock/who"
# Codex's shared cargo runs (~/mgl-test/.slots/<n>) never start while the
# lock is held, but one already running carries on: wait for those to end, so
# nothing builds beside a timing run.
ssh mbp 'until [ -z "$(for d in ~/mgl-test/.slots/*; do [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null && echo x; done)" ]; do sleep 10; done'
ssh mbp "export PATH=\$HOME/.cargo/bin:\$PATH CARGO_TARGET_DIR=\$HOME/idmlab-native/pg-target
set -e
rm -rf $T/out-before $T/out-after
cd $T/before && WSOLA_TRIAL_SONGS=\"$LIST\" WSOLA_TRIAL_OUT=$T/out-before cargo test -q --release -p prism-grain --test wsola_trial render -- --ignored --nocapture 2>&1 | grep -v '^warning\|^ *|\|^ *=\|^$' | tail -20
cd $T/after && WSOLA_TRIAL_SONGS=\"$LIST\" WSOLA_TRIAL_OUT=$T/out-after cargo test -q --release -p prism-grain --test wsola_trial render -- --ignored --nocapture 2>&1 | grep -v '^warning\|^ *|\|^ *=\|^$' | tail -20
echo '== compare (after against before)'
WSOLA_TRIAL_OUT=$T/out-after WSOLA_TRIAL_REF=$T/out-before cargo test -q --release -p prism-grain --test wsola_trial compare -- --ignored --nocapture 2>&1 | grep -- '--'
echo '== how often the search picks differently'
for s in \$(echo \"$LIST\" | tr ';' ' '); do WSOLA_TRIAL_SONG=\$s cargo test -q --release -p prism-grain --lib how_often_real_music_picks_differently -- --ignored --nocapture 2>&1 | grep -E 'ch,|ratio'; done"
mkdir -p "$BACK/before" "$BACK/after"
scp -q "mbp:idmlab-native/wsola-trial/out-before/*.wav" "$BACK/before/"
scp -q "mbp:idmlab-native/wsola-trial/out-after/*.wav" "$BACK/after/"
echo "renders in $BACK"
