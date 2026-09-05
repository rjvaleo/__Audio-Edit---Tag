# Continuous integration

Written 17 Aug 2026, when it was set up.

`.github/workflows/ci.yml`, on push to `main`, on pull requests, and by hand
(`workflow_dispatch`).

## What it runs

One job on `ubuntu-latest`:

1. `libasound2-dev` — `engine` links cpal, which on Linux is ALSA
2. `cargo build --release`
3. `cargo test --release` — 1029 tests
4. `npm ci`, `npm run check` — the static interface check
5. `npx playwright install --with-deps chromium`
6. `npx playwright test` — 241 browser tests

## One job, not two

The browser tests drive the binary the Rust step just built. The interface is
`include_str!`-embedded, so **a second build would be a second interface** and
the point is to test the one that would ship.

It was two jobs for about an hour. Passing a 30 MB binary between them meant an
upload, a download, a second checkout and a few hundred megabytes a day against
a 500 MB artifact quota — to run two things that were serial anyway (`needs:`).
Nothing was gained: a failing step still says which step it was.

## Cost

Private repo, so minutes count against the allowance: 2,000/month on Free,
3,000 on Pro, Linux at the 1× multiplier.

- **~5 minutes** a run warm, **~11–12** cold.
- Roughly **400 pushes a month** free. Overage is $0.008/min — a hundred extra
  runs is about $4.

`actions/cache` **only saves on a successful job**, so while runs are failing
every run is a cold build. The first green run is what starts the saving.

## What it found immediately

Both on its first two runs, and both invisible on any machine here — which is
the argument for having it at all.

**A Linux box.** `cargo test` had only ever run on macOS.

**A box with no sound card.** `/api/engine/state` opened the audio device, so it
answered 503 on a runner with no output — and the interface polls it constantly,
then kept asking the other engine routes and logging the 503s. The test for it
had been written correctly months earlier and could not fail anywhere it had
ever been run. See [`NO-AUDIO-DEVICE.md`](NO-AUDIO-DEVICE.md).

Then a third, one level up: the *test* written for the deviceless machine
assumed the machine had a device. It passed locally and failed on CI.

## Known and left alone

- **Node 20 deprecation warning** on `actions/checkout`, `actions/cache` and
  `actions/setup-node`. They are forced onto Node 24 and still work. Worth
  bumping when it becomes an error, not before.
- **The repository is heavy.** A push warns that one `Audio Library/` AIFF is
  87.83 MB, over GitHub's 50 MB guidance. Audio in git makes every clone heavy
  and every cold CI checkout slower. Not addressed.

## The badge

GitHub's own workflow-status badge **does not work on a private repository**.
The README embeds images through a proxy that fetches them anonymously, and an
anonymous request for a private repo's badge is a 404 — so it renders as a
broken image for everyone, including the owner. Verified rather than assumed:

    curl -o /dev/null -w '%{http_code}' \
      https://github.com/rjvaleo/__Audio-Edit---Tag/actions/workflows/ci.yml/badge.svg
    404

So the README carries a static badge that says what CI does and links to the
Actions page, rather than a live one that would be permanently broken. If this
repository is ever made public, the dynamic badge becomes the better choice and
can go back.

## Watching a run

`gh` is installed.

    gh run list --limit 5
    gh run view <id>
    gh run view <id> --log-failed
