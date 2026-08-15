# Licensing policy

*The rules that keep this sellable. Adopted 15 Aug 2026, when selling it stopped
being a distant idea. Not legal advice — an hour with an actual lawyer before the
first sale is cheap next to what it covers.*

---

## The rule: do not read copyleft source

**Never read GPL, AGPL or LGPL source in any area where we write our own
implementation.** Not to "see how they do it", not to check an edge case, not
out of curiosity.

**Why it is absolute rather than cautious.** Copyright protects expression, not
ideas — so an algorithm can be reimplemented freely, but a reimplementation
written by someone who has just read the original is a derivative work in the
way that matters, and no amount of paraphrasing undoes it. The damage is to
*provenance*, and provenance cannot be repaired later by noticing. A file whose
author read GPL source in that area is permanently questionable. There is no
cleanup, no rewrite-from-memory, no "I only skimmed it".

**What to do instead:**

1. Read the **published description** of the algorithm — papers, the author's own
   write-ups, textbooks, DSP literature. Algorithms are not copyrightable.
2. Read **permissively-licensed** implementations freely. MIT, Apache-2.0, BSD,
   Zlib and Unlicense code can be read, learned from, and even copied with
   attribution.
3. If neither exists and the algorithm genuinely cannot be understood from
   description alone, **buy the commercial licence** or do without. Those are the
   only two honest options.

**Live case: PaulStretch.** Both the original Paul's Extreme Sound Stretch and
the JUCE `paulxstretch` are GPL. The algorithm is published in prose by its
author and is four steps long. Implement from the description. Do not open the
repository.

## The other direction: what we may take on

The test for a new dependency used to be *does it break the Windows
cross-build*. That is retired. What replaces it:

1. **Can it ship?** Bundled into a signed artifact on macOS, Windows and Linux,
   and later living inside a host process without grabbing global state — no
   private audio device, no signal handlers, no assumption that it is the only
   copy in the process.
2. **Does its licence permit selling a closed product?**

| licence | verdict |
|---|---|
| MIT, Apache-2.0, BSD-2/3, Zlib, Unlicense, 0BSD, BlueOak | **yes.** Attribution required, nothing else. |
| MPL-2.0 | **yes.** File-level copyleft; obligations attach only to modified MPL files. Do not modify them. |
| LGPL | **with care.** Permitted if the library stays replaceable and separately linked. Adds shipping obligations; prefer an alternative. |
| GPL, AGPL | **no** — unless the commercial licence is bought. AGPL especially: assume no. |

**Dual-licensed projects are dual-licensed so that commercial users can pay.**
Buying is the normal outcome, not a defeat, and it is usually cheaper than the
engineering required to avoid it.

## The idea that does not work

Shipping a copyleft component as a separate free download that the paid product
loads **does not launder the obligation.**

The GPL is about *source availability, not price*. Making the component free of
charge changes nothing. Copyleft attaches to derivative works, and the tests that
matter — shared address space, dynamic linking, intimate data structures, whether
the product functions without it — all point one way for anything in the audio
path. A stretcher the product requires, linked into the process, is one work with
the product. The consequence is not that the add-on becomes GPL. It is that
**the entire application's source must be published.**

True aggregation — a genuinely separate executable, over a pipe, that the product
works fine without — is defensible. It is also a poor architecture for real-time
audio, and building it to dodge a licence fee smaller than the engineering is a
bad trade.

## Standing obligations

- **[THIRD-PARTY.md](THIRD-PARTY.md) is regenerated whenever a dependency is
  added or bumped.** MIT and Apache both *require* attribution in distributed
  binaries; the violation is shipping without it, not omitting it from the repo.
- **Attribution has to reach the user** — an About box, a bundled NOTICES file,
  or both. A file in the source tree does not discharge the obligation.
- **Non-Rust bundled assets are tracked by hand**, because `cargo metadata`
  cannot see them: p5.js, the two fonts, the YAMNet weights. See THIRD-PARTY.md.
- **JUCE's terms get read before JUCE is underneath all three products**, not
  after.
