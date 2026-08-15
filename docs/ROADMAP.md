# Roadmap

*Five stages, in order. Written 15 Aug 2026 and revised the same day, twice —
once when the ordering changed, once when selling it became a near-term
constraint rather than a distant one. Stage zero starts now. Stages two to four
do not exist yet, and stage one is mostly questions.*

---

## The strategy

**Migrate early, while the surface area is small.** Trim what is not wanted, get
the build bulletproof, move once to the most capable platform, and do the rest
of the building there.

That ordering is right, and the reason is worth stating because it is the whole
argument: the visual system is about 2,700 lines today and it is going to be the
largest part of this program. Porting it now is a week. Porting it after the
visual editor exists and there are fifty patches built on it is a season. The
same is true of the edit suite, which is why it gets built *after* the move
rather than before. **Pay the migration when it is cheapest, which is now.**

The cost of migrating early is that the design is less settled, so some of what
gets ported will be rebuilt anyway. That is the trade, and it is the right one
here because the ported thing is small.

## The five stages

| | | |
|---|---|---|
| **Zero** | Product hygiene | Start the signing certificates, move `data/`, settle the name. Calendar-blocked and unfixable-later items only. |
| **One** | Trim, on paper | Decide what the program is. Three sections in the rail, which visualisers survive, what goes. A written decision, not an HTML edit. |
| **Two** | Bulletproof the core | Fix what is known broken in the part that survives — the Rust. Split the two kinds of state. |
| **Three** | Migrate | Once. JUCE for the shell, wgpu for everything that draws audio. Opens with the compositing prototype, which decides how far the rewrite goes. |
| **Four** | Build | The edit suite, the visual editor, the plugin, hosting, selling. All of it on the new foundation. |

---

# Stage zero — do these now

Everything here is either **calendar-blocked** (it takes wall-clock time you
cannot compress, so it has to start early) or **unfixable later** (the cost of
retrofitting is enormous, or the damage is permanent). None of it is large. All
of it becomes expensive or impossible if left.

## Calendar-blocked — start immediately, they are waiting time not working time

- **Apple Developer Program enrolment.** Approval is not instant and individual
  versus organisation enrolment differ. Nothing ships on macOS without a
  Developer ID, and Gatekeeper blocks unsigned apps outright.
- **Windows code-signing certificate.** OV requires business verification; EV
  requires more. This runs in weeks, not days. And SmartScreen reputation on an
  OV certificate accrues over downloads — the meter starts when the first signed
  build ships, so an early throwaway signed release is worth more than it looks.

These block the first release and nothing else depends on them, so there is no
reason not to start today.

## Unfixable later

- **Do not read GPL source in any area where we write our own.** Once GPL code
  has been read by the author of a file, that file's provenance is permanently
  questionable, and no later cleanup fixes it. Applies immediately to
  PaulStretch — see below. Read published algorithm descriptions, not
  implementations.
- **`data/` moves to the per-user OS directory.** Beside-the-executable is
  read-only inside a signed bundle and is replaced wholesale by any updater.
  After the first sale this destroys every customer's library on their first
  update. This is the single most expensive thing to defer in the document.
- **The product's name, and a trademark search on it.** Rebranding after launch
  costs a website, a bundle identifier, every signed artifact and whatever
  recognition has been built. A search costs an afternoon.
- **A stable bundle identifier and a real version scheme**, in the binary, from
  now. The updater and every signature depend on both being consistent from the
  first release onward.

## Cheap now, tedious later

- **A `THIRD-PARTY.md` and attribution in the shipped binary.** MIT and Apache
  both *require* attribution in distributed products — this is an obligation,
  not politeness. Recording each licence as a dependency is added takes seconds;
  reconstructing it across 136 crates later is a day of misery.
- **Verify the YAMNet model's licence.** The weights ship inside the product.
  They are believed to be Apache-2.0 via `tensorflow/models`, which would be
  fine commercially — but "believed" is not good enough for something being
  sold, and this is a five-minute check.
- **Check the provenance of the tracked audio in `Audio Library/`.** Keeping it
  in the repo was the right call for a personal tool. For a product it is a
  different question: anything from a commercial sample pack cannot ship, and
  anything that is not shipping should not be in the product repository.
- **Read JUCE's current licence terms.** Not to buy yet — the free tier likely
  covers a pre-revenue period — but so the thresholds are known before JUCE is
  underneath all three products rather than after.

---

# Stage one — trim, on paper

**A warning about this stage.** Every visual surface is being rewritten, and the
control interface may be too. Deleting HTML from a build that is about to be
replaced is work that gets thrown away twice — once when it is deleted, and
again when the replacement is written from the decision rather than from the
code.

So stage one is **deciding what the program is**, not implementing it. The
output is a settled list: which sections, which visualisers, what Browse
contains, what Edit will be, what goes. Whether the current HTML is actually
edited to match matters far less than whether the decision is written down — and
where trimming *does* happen it should be to make the thing easier to look at
and judge, not to tidy up a build with a short remaining life.

The exception is anything that changes the **Rust core**, which survives all of
this untouched. Cutting a crate is real work with a real payoff. Cutting a
`<div>` is not.


## The three sections

**The button labelled Edit today is the granular engine.** That is the whole
restructure in one sentence — one honest rename, and one section that does not
exist yet:

```
  today                          wanted
  ─────                          ──────
  [ Edit ]   ←── the granular    [ Granular ]  ← the same workspace, named
             workspace, misnamed                 for what it actually is
                                 [ Edit ]      ← NEW. Built in stage four.
  [ Browse ]                     [ Browse ]    ← unchanged
```

Granular is a rename of something that already works. Browse stays. Edit is the
one that gets built — and on the new ordering it gets built *after* the move,
not before, because building it twice is exactly what this plan avoids.

The rail still carries two axes at once:

```
  [ Edit ] [ Browse ]     ← sections: what you are doing
  ─────────
  [ Library ] [ Search ] [ Scan ] [ Folder ] [ Record ]   ← drawers
```

Now that tagging is core, four of those five drawers are unmistakably the
*interior* of Browse rather than siblings of it. Whether they move underneath it
is a layout call.

## Settled: tagging and browsing stay

*"People use Kontakt with a 5 gig library, we can have a large app."*

`catalog`, `indexer`, `search` and `yamnet` all stay — four of ten crates, the
15 MB model, the fingerprint store, the label store, the tag overrides, the
right-hand inspector and two drawers. Browse is a major section, not a file
tree. Nothing here is a trim candidate.

**The constraint this creates is resident memory, not download size.** Kontakt's
5 GB is content on disk, streamed. The thing that bites is eight plugin
instances each holding the index, the fingerprints, the labels and the model.
Kontakt solves it the way this will have to: one library service per process,
shared and refcounted, many instances reading it. The likely resolution is that
**the app builds the library and the plugin only reads it** — walking 75,000
files and running inference is something you do once, at a desk.

## What is in here now

187 identified elements, so trimming happens against a list rather than from
memory.

**Rail** — 2 sections, 5 drawers.

**Left drawer** — library tree with play-all · similarity search · recorder
(device, arm, meters, naming) · scan progress · library folder and stats.

**Main** — overview with window/cue/playhead · ruler · waveform · spectrogram ·
grain layer · selection · read band · playhead.

**Edit strip** — file tabs · fade shape · snap unit · edited flag ·
undo/redo/revert · export bit depth · export.

**Transport** — play/stop/loop/record · time · zoom out/in/fit · follow mode ·
metadata strip · volume.

**Presets** — pick · with-sound · save · manage · delete, plus the manager
modal.

**Dock**, five tabs — stretch · effects · visuals · automation · regions.

**Right drawer** — the inspector: tag source, two classification levels, tags,
notes, your tags, user vocabulary, learned tags, heard tags, sonic tags,
dirty/discard/commit.

**Visualisers** — six view tabs across two suites, ten views, in an iframe, with
a pop-out.

**Modals** — file picker · ask dialog · preset manager · toast.

## Trim candidates

- **Ten visualisers → two.** *Settled:* Swarm 3D and Swarm 2D survive, plus the
  waveshape view for wavetable. Shear, Braid, Shells, Lattice and the whole V2
  suite go. The moment views can still tell the truth when a grain reads from a
  ring; the object views have **source position** as a structural axis and that
  axis stops existing. See [SIXTH-ENGINE.md](SIXTH-ENGINE.md). This was the
  largest single line item in stage three and it just got 80% smaller.
- **Record.** Not a leftover — it moves into Edit. See
  [TRANSPORT-AND-RECORDING.md](TRANSPORT-AND-RECORDING.md).
- **Regions** against **Edit** — overlapping ideas of the same thing.
- **Stats / why-box** — diagnostics that may have done their job.

---

# Stage two — bulletproof

**A port must start from a build you trust.** If it starts from one with known
bugs, every fault afterwards is ambiguous — did the port break it, or was it
already broken? That ambiguity is expensive and entirely avoidable, and it is
why this is its own stage rather than something done along the way.

What it means concretely:

- **WSOLA reads `grain.wrap`.** Known, reproduced, unresolved. Three options
  written up in the outstanding notes; none chosen.
- **One seam — but only if the controls stay HTML.** Everything through `api()`
  at [app.js:13](../ui/app.js:13); today `grain-views.html` fetches
  `/api/engine/state` on its own and the iframe is loaded by URL. If the
  interface goes all-native this work is void, because the seam it protects
  stops existing. **So the compositing prototype comes first and this waits on
  it.**
- **Split the two kinds of state.** Per-document state (edit list, stretch,
  rack, automation) is per-instance; the library (index, fingerprints, labels,
  model) is process-shared and refcounted. Both live on one `App` today.
- **Windows and Linux actually run.** Windows has a verified PE32+ that has
  never been executed. Linux has never been built. Both should be known-good
  *before* the platform changes underneath them, or the first Windows bug will
  be blamed on the port.
- **`data/` moves to the per-user OS directory.** It sits beside the executable,
  which is read-only in a signed bundle and replaced by any updater.
- **Coverage where it is thin**, so the port has something to be checked
  against. The 898 tests are the only thing that will tell you the DSP survived.

---

# What we should stop writing ourselves

The zero-dependency rule is retired, so the question is open for the first time:
where is hand-rolled code losing to something better? The answer is not uniform,
and for the part that matters most it points away from JUCE rather than towards
it.

## JUCE is the shell, not the graphics and not the analysis

`juce::Graphics` is a **2D vector renderer** — paths, fills, gradients, over a
software or OpenGL backend. It exists to draw knobs and meters, and it is good
at that. It is not a visualization toolkit and it cannot approach what a compute
pipeline does. Every plugin that does heavy visuals — Serum's wavetable view,
Phase Plant, Portal — reaches past `juce::Graphics` to the GPU directly. Using
it for the grain cloud would be a **downgrade** from wgpu, not an upgrade, so
this is one place where "use the best library" and "use JUCE" point in opposite
directions.

**What JUCE genuinely is best-in-class at**, and where hand-rolling would be the
inferior choice:

- **`juce::dsp::Convolution`** — partitioned FFT convolution, properly
  optimised. If convolution reverb or impulse responses are ever wanted, this is
  the answer and writing one is not.
- **`juce::dsp::Oversampling`** — polyphase, clean, and exactly the thing that
  is tedious to get right by hand.

**What JUCE has nothing for:** time stretching, granular synthesis, feature
extraction, or a spectrogram beyond a teaching demo. The five stretchers have no
JUCE equivalent at any quality.

## Where the real upgrades are

Mostly in Rust, which matters because the DSP core stays Rust and these drop in
beside `fx` rather than across a language boundary.

| area | today | better, and why |
|---|---|---|
| **FFT** | hand-rolled radix-2 `f32`, in-place, ~1,900 lines of `audio-core` | **rustfft** / **realfft** — SIMD, mixed-radix, planned transforms. Real-input FFT roughly halves it again. The clearest win in the table, and it makes the vocoder, PVSOLA, the hybrid *and* the spectrogram faster at once. |
| **Resampling** | hand-rolled band-limited, in `yamnet` | **rubato** — sinc-based, high quality, sync and async |
| **Similarity** | six hand-designed features: length, loudness, brightness, noisiness, attack, spectral spread | proper MFCC and chroma, or Essentia-class extraction. The current vector is honest about being basic and it is the weakest link in Browse. |
| **Convolution** | none | `juce::dsp::Convolution`, post-migration |
| **Transparent stretch** | five own engines | a **sixth** engine — see below |

## PaulStretch — worth having, and worth being careful about

**Do not read the source.** Both the original Paul's Extreme Sound Stretch and
the JUCE `paulxstretch` are GPL. Reading GPL source and then writing something
in the same area compromises the provenance of whatever gets written, and it
compromises it permanently — that is not a thing that can be undone later by
noticing. This is the first live instance of the rule in stage zero.

**Read the algorithm instead, which its author published in prose.** Algorithms
are not copyrightable; expression is. A clean-room implementation from the
description is legitimate, standard practice, and in this case also easier than
porting would be.

The algorithm, in full:

1. Take **very large** windows — a quarter of a second to several seconds, far
   larger than a phase vocoder's.
2. Window (Hann), FFT.
3. **Randomise the phases completely.**
4. IFFT, overlap-add at 50%.

That is the whole thing, and the third step is the insight. Every other
stretcher fights to *preserve* something — transients, phase coherence, the
spectral envelope. PaulStretch observes that at ×10 or ×50 the material is
unrecognisable anyway, so preserving phase is wasted effort, and throwing it away
entirely produces a smooth cloud instead of the metallic smearing a phase
vocoder gives at those ratios. It turns any sound into an ambient pad.

**Why it belongs here specifically:**

- It fills a real gap. All five current engines are transparency-seeking in
  different ways. None of them *deliberately destroys* phase, so none of them
  does this sound.
- It is the natural partner to the grain cloud aesthetically — extreme ratios,
  texture over fidelity.
- It is the simplest engine of the set. Given `audio-core` already has FFT and
  Hann windowing, it is on the order of 150 lines.
- **Its randomness fits invariant 2 exactly.** Phase per bin as a pure function
  of bin index and seed — not a running generator — means the waveform, the
  playback and the export agree, and the visualiser can draw it. The same
  discipline the grain cloud already follows, applied to a spectrum.

## The stretchers stay, and a sixth may join them

Rubber Band would probably beat WSOLA on transparent material. It would also be
the wrong trade: no library does the grain cloud, and nothing off the shelf
gives grains as a pure function of index and seed — which is the property the
whole visualiser and the offline video renderer depend on. Replacing the
stretchers would trade the identity of the program for a transparency it is not
trying to have.

Adding a sixth engine that *is* best-in-class transparent — Signalsmith Stretch,
or Rubber Band — is a different and legitimate proposition: *when you want it
invisible, use this one.* It sits in the existing `Algorithm` enum beside the
other five and costs nothing that already works.

## Licensing is the new filter

*Not legal advice. The picture below is accurate as engineering guidance, and
one hour of an actual lawyer before the first sale is cheap insurance on top of
it.*

"Does it break the Windows cross-build" is retired. What replaces it has two
parts:

1. Can it be bundled into a signed artifact on three platforms, and live inside
   a host process without grabbing global state?
2. **Is its licence compatible with selling closed-source?**

### The verdict

| | licence | verdict |
|---|---|---|
| rustfft, realfft, rubato, wgpu | MIT / Apache-2.0 | **clean.** No obligations beyond attribution. |
| Signalsmith Stretch | permissive — **verify before committing** | probably clean |
| **JUCE** | GPL **or** commercial | **buy it.** Free tier below a revenue threshold; paid above. Check current terms — they have changed several times. |
| **Rubber Band** | GPL **or** commercial | **buy it, if wanted.** A real commercial licence is sold; it is a line item, not a blocker. Only needed for the optional sixth stretcher. |
| Essentia | AGPL | **do not use.** A commercial licence exists through the university, but see below — it is not needed. |
| chromaprint | LGPL | **skip.** Wrong tool anyway: it identifies *the same recording*, not *similar sounds*. |
| FFTW | GPL or commercial | never comes up — rustfft is MIT and better suited. |

**The best options are already the freest.** That is not luck so much as the
state of the Rust audio ecosystem, and it means licensing is a small purchase
decision rather than a design constraint.

### The "free plugin" idea does not work

Shipping a GPL component as a separate free download that the paid product loads
does not launder the obligation, and it is worth being blunt about why, because
the idea is intuitive and wrong.

**The GPL is about source availability, not price.** Making the GPL part free of
charge changes nothing; the obligation is to publish source for the combined
work. Copyleft attaches to derivative works, and the tests that matter — shared
address space, dynamic linking, intimate data structures, whether the product
functions without it — all point the same way for a component in the audio path.
A stretcher your product requires, linked into your process, is one work with
your product. The consequence is not that the plugin becomes GPL. It is that
**your entire application's source must be published.**

True aggregation — a genuinely separate executable, over a pipe, that the
product works fine without — is defensible. It is also a bad architecture for
real-time audio and not worth building to avoid a licence fee that is smaller
than the engineering.

### So the three real options, in order

1. **Buy the licence.** Dual-licensed projects are dual-licensed precisely so
   commercial users can pay. This is the normal answer for JUCE and Rubber Band
   and it is cheap relative to the work it saves.
2. **Substitute something permissive.** Which, for most of the list, is also the
   better library.
3. **Roll our own** where the algorithm is standard and the implementation is
   not the hard part. **MFCC and chroma are exactly this** — a few hundred lines
   each, thoroughly documented, and the reason Essentia never needs to enter the
   product. The existing fingerprinter already proves this is within reach; it
   just needs better features than the six it has.

---

# Stage three — migrate, once

## The shell: JUCE

Settled, and not really by preference. Hosting VST3 and AU in the effect rack
means `AudioPluginFormatManager`, which has no real competitor in any language,
and AU means JUCE or a wrapper chain you do not control. JUCE also builds
Standalone, VST3 and AU from one target list, so the app and the plugin are one
codebase.

`cpal` goes away and JUCE's `AudioDeviceManager` replaces it — which brings
proper ASIO on Windows, something your buyers will expect and cpal handles
badly. `engine/device.rs` is the only file that dies.

## The graphics: native, and as far past p5 as it goes

**Settled.** "p5 100%" was a floor rather than a ceiling — it meant *stop
offering me less*, after I had dropped 3D for flat canvas three times. The rule
is that the direction is always more capable:

> *"I WANT MORE. MORE IS BETTER. BETTER THAN P5 IS 1000% GOOD."*

p5 is a teaching and sketching library over WebGL. It is the right answer inside
a browser and it is nowhere near the ceiling. The three candidates, for the
record:

| | ceiling | port cost |
|---|---|---|
| **A — JUCE webview + p5** | WebGL2 in a sandboxed webview. Post-processing hand-rolled. Instancing weak — thousands, not millions. | ~zero |
| **B — JUCE webview + three.js** | Real post chain (bloom, DOF, film grain), `InstancedMesh` at 100k+, GPGPU in float textures. Still sandboxed. | rewrite ~2,700 lines |
| **C — JUCE + wgpu native surface** | Compute shaders, HDR, full post pipeline, millions of instances. No sandbox, no webview tax. | rewrite in WGSL + Rust |

**C.** And there is one argument that decides it beyond raw capability.

Today the visualiser receives grain data over HTTP as JSON, capped at 8,000
grains, strided to fit. That cap is not a design choice — it is the cost of the
transport. With wgpu the visualiser lives in Rust beside `fx` and reads
`fx::grain::grains()` **directly**, the same enumeration the renderer and the
exporter use. No serialization, no JSON, no hop, no cap.

That is invariant 3 extended to the visuals, and it is exactly what
[WITNESS.md](../visualiser/WITNESS.md) argues the picture owes the sound. The
HTTP hop and the 8,000-grain cap are the two places the program currently
compromises that philosophy, and going native removes both rather than working
around them.

wgpu is also pure Rust targeting Metal, Vulkan and D3D12 from one codebase — so
"Metal or Vulkan for bragging rights" is one decision, not three, and it does
not reintroduce a C dependency.

**The honest costs of C:** WGSL is a new authoring surface and GPU debugging is
harder than reading a p5 sketch. Compositing a native GPU view with the HTML
control UI inside a JUCE window is real per-platform work — though it is *easier*
inside a plugin, where a native GPU view is how every modern plugin GUI already
works. And it is the single largest piece of work in this plan.

## Where the line falls

An earlier draft of this document kept the spectrogram, the meters, the waveform
and the grain layer in HTML canvas as "interface". That was wrong, and it was
wrong on this program's own terms rather than on taste.

**Everything that draws audio data goes native. All of it.**

| | why it is not interface |
|---|---|
| **Spectrogram** | It is a texture — a float array mapped to colour. Canvas does it by pushing pixels from the CPU every frame; a shader does it free, with log-frequency remapping and a real colourmap. |
| **Waveform and overview** | Peak tiles exist to make canvas fast enough. On the GPU there is no tile management and no zoom cost. |
| **Meters** | Trivial to draw, but leaving them in the DOM means compositing DOM over GPU — they cost more where they are than where they are going. |
| **Grain layer over the waveform** | The decisive one, below. |

The grain layer and the grain cloud draw **the same grains**. Splitting them
across two rendering systems means two implementations of grain rendering, and
this program has already been burned by exactly that: the block renderer once
carried its own copy of the grain envelope with a comment promising it matched
the other one. Invariant 3 exists because of it — the offline renderer, the
real-time renderer and the visualiser share one enumeration. Drawing the same
grains in WGSL in one place and canvas 2D in another reintroduces the precise
duplication that invariant was written to forbid.

So the line is not size and it is not importance. It is:

> **Audio data is rendered. Controls are laid out.**

Waveform, overview, spectrogram, meters, grain layer and grain cloud become one
pipeline over one set of GPU buffers — the playhead, the read band and the
selection drawn in the same pass. That is faster *and* more consistent than what
exists now, which is five separate canvases that each re-derive their own view
of the same audio.

## The remaining question: the controls

Buttons, sliders, the library tree, the tag inspector, menus, dialogs. This is
genuinely open, and it is the largest scope decision left.

**Keeping them HTML** costs a permanent compositing tax — a native GPU surface
under a webview, per platform, inside a plugin window, with z-order, transparency
and resize tearing to get right — and keeps the webview divergence problem
(WKWebView, WebView2, WebKitGTK all behaving differently) forever. What it buys
is that HTML is the best tool ever built for document-shaped interfaces, and a
75,000-file browser with search, tags and notes is exactly that. The node-based
visual editor is also far easier in HTML and SVG than in a native toolkit.

**Going all-native** deletes more than it costs. No compositing problem at all.
No webview divergence. No iframe. And — the big one — **no seam**: no HTTP, no
44 routes, no JSON marshalling, no `api()`. The interface would call Rust
directly. Stage two's "one seam" work stops being necessary because the thing it
was protecting stops existing. It is also how every professional audio product
is built; none of Kontakt, Serum, Omnisphere or Arcade is a webview.

**This is empirical, not philosophical.** Whether a native GPU surface
composites cleanly under an HTML control layer on all three platforms is
something a week of prototyping answers definitively and no amount of arguing
answers at all. It should be the *first* thing built in stage three, before
anything is ported, because both roads are viable and the prototype picks one.

## What moves

| | |
|---|---|
| **Survives untouched** | All DSP: `audio-core`, `fx`, `edit`, `engine::render`, `engine::stretcher`, `engine::transport`. The library half: `catalog`, `indexer`, `search`, `yamnet`. The HTML control interface. |
| **Replaced** | `engine/device.rs` → JUCE `AudioDeviceManager`. `audiolab/main.rs`, all fifty lines. |
| **Depends on the graphics decision** | The ten p5 sketches and the iframe that hosts them. |
| **Deferred** | The HTTP layer. The standalone's webview can keep talking to loopback, so `server` ships unchanged at first. It only has to go when the plugin arrives and eight instances would mean eight ports. |

---

# Stage four — build

On the new foundation, in roughly this order:

**The Edit section.** The engines are further along than the interface suggests:
[edit](../core/crates/edit/src/lib.rs) is 2,136 lines — clips, fade shapes,
ranges, snapping, zero-crossing, undo/redo/revert — and
[automation.rs](../core/crates/server/src/automation.rs) is 1,467 lines of
curves, modulators, lanes, a runner and Touch/Latch record modes. Both are
missing interface, not engine.

**The visual editor.** New visuals built the way new sounds are. The machinery
is the rack again: emitters, forces, materials and a post chain, each a module
with named parameters, automated by the automation engine without it knowing the
parameters are visual. `SlotSpec` is already *name plus named floats plus
bypass*.

**Offline video rendering.** Invariant 2 — grain randomness is a pure function
of index and seed, never a running generator — is precisely what frame-by-frame
offline rendering needs. Frame 40,000 at any quality, matching what was heard.
That fell out of a decision made for a completely different reason.

**Plugin hosting in the rack.** `SlotSpec` at
[rack.rs:33](../core/crates/server/src/rack.rs:33) is already the right shape,
and `slot_ids` already gives automation stable addressing across reorders.
Hosting is a subsystem — out-of-process scanning, parameter bridging, delay
compensation, crash isolation — and a hosted plugin's editor is a native window.

**The plugin version.** Everything the app does. This is where the seam and the
shared library service stop being tidiness and start being load-bearing.

**Selling it.** Apple Developer ID and notarization; a Windows code-signing
certificate; AppImage on Linux. Updates as a signed manifest on static hosting,
no server anywhere. Paddle or Lemon Squeezy as merchant of record.

---

## Open questions, in the order they block things

1. **Do the controls stay HTML, or go native too?** The largest scope decision
   left, and the one that voids or validates several other pieces of work. It is
   answered by a compositing prototype, not by discussion, and that prototype is
   the first thing built.
2. **What happens to the dock?** Stretch travels with Granular; Effects,
   Visuals, Automation and Regions have no obvious home.
3. **Do the library drawers move underneath Browse?**
4. **What is the order** of Granular, Edit and Browse in the rail?
5. **Does the plugin host plugins?** Nesting is where this gets silly; my
   instinct is no.

*Settled: tagging and browsing stay and a large app is fine · today's Edit
button is Granular renamed, and Edit is built new · record belongs to Edit ·
JUCE is the shell · graphics go native on wgpu, past p5 · ten visualisers become
two plus the waveshape view · migrate early, while the surface is small.*
