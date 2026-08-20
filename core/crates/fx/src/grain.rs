//! Granular synthesis controls for the time stretcher.
//!
//! WSOLA is a special case of granular: fixed grain size, hop set by the time
//! ratio, and a similarity search to pick splice points. Generalising it gives
//! independent control of when grains happen, how long they are, where they
//! read from, and what pitch each one plays at.
//!
//! **All randomness is a pure function of the grain index and a seed.** Nothing
//! here advances a hidden generator. That is not a stylistic choice: the
//! waveform display, playback and the exported file are rendered by separate
//! calls, and a running RNG would give each of them different audio — the
//! picture would stop matching the sound.

/// Per-grain variation. Defaults are all inert, so a fresh document behaves
/// exactly as the plain stretcher did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Grain {
    /// Grains per second, **for the grain cloud alone**.
    ///
    /// The rate the cloud emits at, independent of how long a grain lasts. A
    /// grain is an event: it is spawned, it sounds for as long as it lasts, and
    /// it ends, and none of that waits on the grain before it. So the same
    /// number of them is laid down every second whether they are five
    /// milliseconds long or two seconds.
    ///
    /// This is not `density_hz`, and the difference is the whole reason it
    /// exists. `density_hz` is read by every engine — WSOLA, the vocoder,
    /// PVSOLA and the hybrid all take their hop from it through
    /// `stretch::hop_frames`, where it means how far a *transform* advances
    /// rather than how often a grain is thrown. Making it the cloud's control
    /// would reach into four engines that do not want it: past a 100 ms window
    /// it takes them from 2x overlap to the floor's 8x, four times the
    /// transform work, for a setting that only ever described grains. See
    /// `docs/GRAIN-EMISSION.md`.
    ///
    /// Zero means "as it always was": the hop comes from `density_hz` if that
    /// is set, and from the window over `overlap` if it is not. A document
    /// written before this existed therefore sounds exactly as it did.
    pub rate_hz: f32,
    /// Grains per second. Zero derives it from grain size and overlap, which is
    /// the classic behaviour.
    ///
    /// Shared with the window engines; see `rate_hz` above for why the cloud no
    /// longer takes its own rate from here.
    pub density_hz: f32,
    /// How many grains cover any given moment. 2.0 is 50% overlap.
    pub overlap: f32,
    /// Randomises grain length, 0..1 as a fraction of the base size.
    pub size_jitter: f32,
    /// Randomises where in the source each grain reads from, in milliseconds.
    pub position_jitter_ms: f32,
    /// Random pitch offset per grain, in semitones. Instant, uncorrelated.
    pub pitch_jitter_semis: f32,
    /// Slow wandering pitch offset, in semitones. Smooth, correlated in time.
    pub pitch_drift_semis: f32,
    /// How fast the drift wanders, in Hz.
    pub drift_rate_hz: f32,
    /// How many independent grain streams run at once.
    ///
    /// One stream is a stretcher: grains laid end to end, each covering the
    /// moment the last one left. Several streams is a *cloud* — the same source
    /// read simultaneously from several places, each with its own jitter and
    /// its own drift, so the density on the page is a multiple of what one
    /// schedule can produce rather than the same grains packed tighter.
    ///
    /// Each layer is offset within the hop as well as re-seeded, so two layers
    /// do not simply land on top of each other and sound like one grain twice
    /// as loud.
    pub layers: u32,
    /// Chosen by the user; the same seed always gives the same result.
    pub seed: u32,

    // Below here, the assumptions the schedule normally makes.

    /// Where the read head sits in the source, as a fraction of it.
    ///
    /// The control the cloud was missing. `scan` could stop the sweep, but only
    /// ever parked it at frame zero — so a cloud could be made from one instant
    /// and that instant was always the beginning of the file. There was no way
    /// to say "make a cloud from eight seconds in", which is most of what a
    /// granular instrument is for.
    ///
    /// Measured from wherever the sweep would begin: the start going forwards,
    /// the end going backwards. Zero is therefore exactly what every document
    /// written before this control existed already does, in both directions.
    ///
    /// Automatable, which is the other half of it. A lane drawn on this is a
    /// read head skipping around the source under its own hand, with playback
    /// of the file no longer tied to where the output has got to.
    pub position: f32,
    /// How fast the read pointer sweeps the source, relative to the sweep the
    /// time ratio implies. One is a stretch: the pointer covers the file in
    /// exactly the output duration. Zero holds it at the beginning, so the
    /// whole output is a cloud made from one instant. Negative sweeps backwards
    /// from the end.
    pub scan: f32,
    /// Each grain reads its own span backwards. The cloud still moves forward.
    pub reverse: bool,
    /// Where the grain envelope peaks. A half is the symmetric Hann; toward
    /// zero the attack sharpens and the tail lengthens, which reads as
    /// percussive; toward one it is the same shape reversed, so every grain
    /// swells and stops.
    pub envelope: f32,
    /// Multiplies how far size jitter may reach. One keeps the tuned range of
    /// roughly half to double; higher lets a single cloud hold grains from a
    /// few samples to several seconds.
    pub size_range: f32,
    /// Position jitter wraps around the file instead of being clamped inside
    /// it, so a grain pushed past the end reappears at the beginning.
    pub wrap: bool,
    /// How far each layer's read pointer is thrown from the others, 0..1.
    ///
    /// Zero is where this started and it is why layers used to thicken so
    /// poorly: every layer read the *same* instant of the source and was laid
    /// down a fixed fraction of a hop later, which is a delay line, not a
    /// cloud. Regular delays make regular notches — measured at sixteen layers,
    /// the spectrum's ripple went from 7.8 dB to 11.9 dB and the level wandered
    /// between 1.4x and 0.8x.
    ///
    /// Turned up, each layer reads from its own place, so the layers are
    /// different audio rather than copies of one. They then sum like a crowd
    /// instead of interfering like a comb.
    pub layer_scatter: f32,
    /// How far a scattered layer may be thrown, in milliseconds.
    ///
    /// Small is a chorus — the layers are the same moment heard from slightly
    /// different places. Large is a wash, where each layer is somewhere else in
    /// the sound entirely and what you hear is the texture rather than the
    /// moment.
    pub layer_scatter_ms: f32,
    /// This layer's own throw, in frames. Derived, never a control.
    ///
    /// Set by the three places that lay layers down — the offline renderer, the
    /// grain cloud and the block renderer — so that all three scatter
    /// identically. It is deliberately not part of what `is_clean` looks at and
    /// is not written to disk: it is a working value, not a setting.
    pub layer_read: f32,
    /// How far apart layers sit within the hop. One spaces them evenly. Zero
    /// stacks them on the same instants, which is louder rather than denser.
    pub layer_spread: f32,
    /// Size, position and pitch jitter draw from one random stream instead of
    /// three, so they move together: a long grain is also the displaced one and
    /// the detuned one.
    pub link_jitter: bool,
    /// Drift steps between values instead of gliding through them.
    pub drift_step: bool,
    /// Spreads grains across the stereo field, each to its own place.
    pub pan_spread: f32,
}

impl Default for Grain {
    fn default() -> Self {
        Grain {
            rate_hz: 0.0,
            density_hz: 0.0,
            overlap: 2.0,
            // Zero is the sweep's own beginning, which is where it always was.
            position: 0.0,
            size_jitter: 0.0,
            position_jitter_ms: 0.0,
            pitch_jitter_semis: 0.0,
            pitch_drift_semis: 0.0,
            drift_rate_hz: 0.5,
            layers: 1,
            layer_scatter: 0.0,
            layer_scatter_ms: 120.0,
            layer_read: 0.0,
            seed: 1,
            scan: 1.0,
            reverse: false,
            envelope: 0.5,
            size_range: 1.0,
            wrap: false,
            layer_spread: 1.0,
            link_jitter: false,
            drift_step: false,
            pan_spread: 0.0,
        }
    }
}

impl Grain {
    /// Nothing here would change the sound, so the plain stretcher can be used.
    pub fn is_clean(&self) -> bool {
        self.density_hz <= 0.0
            && (self.overlap - 2.0).abs() < 1e-3
            && self.size_jitter.abs() < 1e-4
            && self.position_jitter_ms.abs() < 1e-4
            && self.pitch_jitter_semis.abs() < 1e-4
            && self.pitch_drift_semis.abs() < 1e-4
            && self.layers <= 1
            // The rest are inert at their defaults, but every one of them
            // changes the sound off it, so each has to be checked here or a
            // document carrying it would be mistaken for an untouched one and
            // skip the stretcher entirely.
            && self.position.abs() < 1e-4
            && (self.scan - 1.0).abs() < 1e-4
            && !self.reverse
            && (self.envelope - 0.5).abs() < 1e-4
            && (self.size_range - 1.0).abs() < 1e-4
            && !self.wrap
            && (self.layer_spread - 1.0).abs() < 1e-4
            && self.layer_scatter.abs() < 1e-4
            && !self.link_jitter
            && !self.drift_step
            && self.pan_spread.abs() < 1e-4
    }

    /// Uniform random in 0..1 for grain `index`. `salt` separates the streams,
    /// so changing pitch jitter does not also reshuffle grain sizes.
    pub fn rand01(&self, index: u64, salt: u32) -> f32 {
        let mut x = (index.wrapping_mul(0x9E37_79B9_7F4A_7C15))
            ^ ((self.seed as u64) << 1)
            ^ ((salt as u64).wrapping_mul(0xD1B5_4A32_D192_ED03));
        x ^= x >> 30;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 27;
        x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
        x ^= x >> 31;
        ((x >> 40) as f32) / 16_777_216.0
    }

    /// Bipolar random in -1..1.
    pub fn rand_bipolar(&self, index: u64, salt: u32) -> f32 {
        self.rand01(index, salt) * 2.0 - 1.0
    }

    /// Smooth wander in -1..1 at `t` seconds.
    ///
    /// Value noise rather than white noise: drift is meant to be heard as
    /// slowly going out of tune, which needs neighbouring moments to agree.
    pub fn drift_at(&self, t: f32) -> f32 {
        let rate = self.drift_rate_hz.max(0.01);
        let x = t * rate;
        let i = x.floor().max(0.0) as u64;
        let f = x - x.floor();
        let a = self.rand_bipolar(i, 77);
        if self.drift_step {
            // Hold each value until the next node. Same nodes, no glide — the
            // difference between going slowly out of tune and being moved.
            return a;
        }
        let b = self.rand_bipolar(i + 1, 77);
        let s = f * f * (3.0 - 2.0 * f); // smoothstep
        a + (b - a) * s
    }

    /// Which random stream a given kind of jitter draws from.
    ///
    /// Separate salts are what keep the jitters independent: changing pitch
    /// jitter must not also reshuffle grain sizes. Linking them collapses all
    /// three onto one stream, so they vary in step.
    pub fn salt(&self, kind: u32) -> u32 {
        if self.link_jitter {
            3
        } else {
            kind
        }
    }

    /// Pitch offset in semitones for grain `index` starting at `t` seconds.
    pub fn pitch_offset(&self, index: u64, t: f32) -> f32 {
        self.pitch_jitter_semis * self.rand_bipolar(index, self.salt(11))
            + self.pitch_drift_semis * self.drift_at(t)
    }
}

/// One grain: where it lands, where it reads from, how long, at what pitch.
///
/// The renderer and the visualiser both consume these, so what you see is
/// necessarily what you hear. Computing them twice would let the two drift.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GrainEvent {
    pub index: u64,
    /// Output frame the grain starts at.
    pub out_frame: u64,
    /// Source frame it reads from, fractional.
    pub src_frame: f32,
    /// Length in output frames.
    pub size: u32,
    /// Read rate; 1.0 is unshifted.
    pub rate: f32,
    /// Total pitch offset in semitones, base plus jitter plus drift.
    pub pitch_semis: f32,
}

/// The grain schedule for a render. Deterministic and cheap — no audio is read.
pub struct GrainPlan {
    pub hop: usize,
    pub base_size: usize,
    pub out_frames: usize,
}

pub fn plan(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    window_ms: f32,
    g: &Grain,
) -> GrainPlan {
    let sr = sample_rate.max(1) as f32;
    let ratio = ratio.clamp(0.01, 100.0);
    // Long windows are what make an extreme stretch sound like a texture
    // rather than a stutter, so two seconds is allowed.
    let base_size = (((window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(32);
    let overlap = g.overlap.clamp(1.0, 8.0);
    // The cloud's own rate first, then the shared one, then the window.
    //
    // Only the first of these is free of the window. `density_hz` is the same
    // number the window engines read; the third *is* the window, divided by how
    // many should cover a moment, and it is why lengthening a grain used to
    // thin the cloud — at 40 ms and 2x it lays down fifty a second, and at
    // 200 ms it lays down ten.
    //
    // No floor beyond the eight frames that keep the schedule finite. A small
    // hop is the entire point here, unlike in `stretch::hop_frames` where it is
    // an overlap of a transform and has to bear some relation to its size.
    let hop = if g.rate_hz > 0.0 {
        ((sr / g.rate_hz.clamp(0.1, 2000.0)) as usize).max(8)
    } else if g.density_hz > 0.0 {
        ((sr / g.density_hz.clamp(0.5, 2000.0)) as usize).max(8)
    } else {
        (base_size as f32 / overlap).max(8.0) as usize
    };
    GrainPlan {
        hop,
        base_size,
        out_frames: ((in_frames as f32) * ratio).round() as usize,
    }
}

/// Everything the schedule depends on, in one value so it can be swapped
/// wholesale between grains. The real-time path reads this fresh at every
/// grain; the offline path holds it constant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StreamParams {
    pub in_frames: usize,
    pub sample_rate: u32,
    pub ratio: f32,
    pub semitones: f32,
    pub window_ms: f32,
    pub grain: Grain,
    /// Which engine the callback should run.
    ///
    /// The audio thread used to have no idea this existed — it ran the grain
    /// cloud whatever the document said, which is why choosing an engine
    /// changed the exported file and never changed what you heard.
    pub algorithm: crate::stretch::Algorithm,
    /// WSOLA's own settings, for when that is the engine running.
    pub wsola: crate::stretch::WsolaParams,
    /// The vocoder's own settings, likewise.
    pub vocoder: crate::stretch::VocoderParams,
    /// How often PVSOLA stops trusting the propagated phase.
    pub pvsola: crate::pvsola::PvsolaParams,
    /// How the hybrid splits the sound up and what it does with each part.
    pub hybrid: crate::hybrid::HybridParams,
    /// Whether the grain cloud runs as a layer over the engine above.
    /// See `Stretch::cloud`; this is the same switch, on the audio thread.
    pub cloud: bool,
    /// How much of it, equal power. See `Stretch::cloud_mix`.
    pub cloud_mix: f32,
}

impl StreamParams {
    /// A starting set for a source of a given length. Everything else is the
    /// engines' own defaults, so a caller only has to name what it cares about.
    pub fn new(in_frames: usize, sample_rate: u32) -> Self {
        StreamParams {
            in_frames,
            sample_rate,
            ratio: 1.0,
            semitones: 0.0,
            window_ms: 40.0,
            grain: Grain::default(),
            algorithm: crate::stretch::Algorithm::Granular,
            wsola: crate::stretch::WsolaParams::default(),
            vocoder: crate::stretch::VocoderParams::default(),
            pvsola: crate::pvsola::PvsolaParams::default(),
            hybrid: crate::hybrid::HybridParams::default(),
            cloud: false,
            cloud_mix: 0.5,
        }
    }
}

impl StreamParams {
    pub fn plan(&self) -> GrainPlan {
        plan(
            self.in_frames,
            self.sample_rate,
            self.ratio,
            self.window_ms,
            &self.grain,
        )
    }
}

impl Grain {
    /// Where this layer's read pointer is thrown to, in frames.
    ///
    /// Derived from the layer index rather than the seed, so it is stable
    /// whatever else is being randomised, and bipolar around zero so the layers
    /// sit either side of the moment rather than all drifting one way.
    ///
    /// Layer zero never moves. Something has to stay where the sound actually
    /// is, or turning scatter up would slide the whole cloud off the beat.
    pub fn layer_throw(&self, layer: u32, sample_rate: u32) -> f32 {
        if layer == 0 || self.layer_scatter.abs() < 1e-4 {
            return 0.0;
        }
        let range = (self.layer_scatter_ms.clamp(0.0, 5000.0) / 1000.0) * sample_rate.max(1) as f32;
        self.layer_scatter.clamp(0.0, 1.0) * range * self.rand_bipolar(layer as u64, 11)
    }
}

/// How much to lift the output for a given layer count.
///
/// Layering loses level, and only on this engine. The overlap-add divides by the
/// summed window height — effectively by the *number* of grains — but grains
/// that do not line up with each other sum in amplitude by only the *square
/// root* of their number. So N layers of jittered grains come out at 1/√N, and
/// every doubling of the layer count quietly costs 3 dB. Measured: sixteen
/// layers land at 0.25, which is 1/√16 exactly.
///
/// The other engines never had this because their layering goes through
/// `stretch::layered`, which measures one layer's RMS and scales the sum back to
/// it. That cannot be done here: the real-time renderer is handed a few hundred
/// frames at a time and cannot measure the RMS of audio it has not produced yet,
/// so a measured correction would make live playback and the exported file
/// disagree — which is the one thing this module exists to prevent.
///
/// √N is therefore applied blind, in both paths, from this one function. It is
/// exact whenever the grains are decorrelated, which is whenever any jitter is
/// on, which is when layers are worth using at all. On the degenerate case —
/// several layers with no jitter and no spread, so every layer is the same audio
/// — the layers sum coherently and this makes them √N too loud. That is the
/// accepted cost of the two paths agreeing, chosen deliberately over a
/// measurement only one of them can take.
pub fn layer_gain(layers: u32) -> f32 {
    (layers.clamp(1, 16) as f32).sqrt()
}

/// One grain, given its index and where it lands.
///
/// Both the offline enumeration and the real-time stream call this. Having a
/// single implementation is not tidiness: two copies would let the picture, the
/// playback and the exported file drift apart, which is the whole thing this
/// module exists to prevent.
fn event_at(index: u64, write: usize, p: &GrainPlan, sp: &StreamParams) -> GrainEvent {
    let sr = sp.sample_rate.max(1) as f32;
    let ratio = sp.ratio.clamp(0.01, 100.0);
    let g = &sp.grain;
    let pos_jitter = (g.position_jitter_ms / 1000.0) * sr;
    let base_rate = 2f32.powf(sp.semitones / 12.0);

    let t = write as f32 / sr;
    let size = if g.size_jitter > 1e-6 {
        // `size_range` widens how far the deviation may reach. At one the clamp
        // is the tuned half-to-double; beyond it, one cloud can hold grains
        // that are barely a click and grains that are most of a bar.
        let range = g.size_range.clamp(1.0, 8.0);
        let k = 1.0 + g.size_jitter.clamp(0.0, 1.0) * range * g.rand_bipolar(index, g.salt(3));
        ((p.base_size as f32) * k.clamp(0.15 / range, 2.0 * range)) as usize
    } else {
        p.base_size
    }
    .max(16);

    let semis = g.pitch_offset(index, t);
    // Four octaves of base shift, plus whatever the jitter and drift add on
    // top, so the clamp has to be wider than the control range.
    let rate = (base_rate * 2f32.powf(semis / 12.0)).clamp(0.002, 256.0);

    // Where in the source this moment reads from. `scan` breaks the link to the
    // ratio: at zero the sweep stops and every grain comes from the beginning;
    // negative sweeps back from the end, so the cloud runs the file in reverse
    // while still being laid down forwards.
    let scan = g.scan.clamp(-4.0, 4.0);
    let sweep = ((write as f32) / ratio) * scan;
    // Where the sweep starts from, plus wherever the head has been moved to.
    // The offset is measured from the natural beginning of the sweep, which is
    // what keeps zero meaning exactly what it meant before this control
    // existed — including for a reverse scan, which starts at the end.
    let home = if scan < 0.0 { sp.in_frames as f32 } else { 0.0 };
    let nominal = home + g.position.clamp(-1.0, 1.0) * sp.in_frames as f32 + sweep;

    let jitter = if pos_jitter > 0.0 { pos_jitter * g.rand_bipolar(index, g.salt(5)) } else { 0.0 };
    // This layer's own throw, so the layers are different audio rather than
    // copies of one laid down at a fixed offset.
    let jitter = jitter + g.layer_read;
    let span = (size as f32) * rate;
    let want = nominal + jitter;
    // Wrapped, the file is a loop and every frame of it is a legal place to
    // start: a grain that runs off the end carries on from the beginning, so
    // there is no last-safe-position to be held back to.
    //
    // Unwrapped, there is. `max_start` is the file less the span this grain
    // will read, and a grain that wants to start later is held there. Note that
    // the span is `size × rate`, so the limit is different for every grain —
    // size jitter and pitch jitter both move it. There is no single boundary,
    // which is why drawing one on the picture was describing something the
    // audio does not have.
    let read = if g.wrap {
        want.rem_euclid((sp.in_frames as f32).max(1.0))
    } else {
        let max_start = (sp.in_frames as f32 - span - 1.0).max(0.0);
        want.clamp(0.0, max_start)
    };

    GrainEvent {
        index,
        out_frame: write as u64,
        src_frame: read,
        size: size as u32,
        rate,
        pitch_semis: sp.semitones + semis,
    }
}

/// Independent grain streams. Matches the clamp in [`granular`], and has to: a
/// layer the renderer refuses to run is a layer you hear offline and not while
/// playing.
pub const MAX_LAYERS: usize = 16;

/// How many schedules are running. Clamped exactly as the offline renderer
/// clamps it, so the two never disagree about how many there are.
pub fn layer_count(sp: &StreamParams) -> u32 {
    sp.grain.layers.clamp(1, MAX_LAYERS as u32)
}

/// A layer's own parameters. Re-seeding is what makes it an independent cloud
/// rather than the same one drawn twice; layer zero keeps the seed it was given
/// so a single-layer render is untouched by any of this.
pub fn layer_params(sp: &StreamParams, layer: u32) -> StreamParams {
    let mut lp = *sp;
    if layer > 0 {
        lp.grain.seed = sp.grain.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
    }
    lp.grain.layer_read = sp.grain.layer_throw(layer, sp.sample_rate);
    lp
}

/// Where a layer sits within the hop. Even spacing scaled by the spread
/// control, so at zero they stack and are merely louder.
pub fn layer_offset(sp: &StreamParams, layer: u32, layers: u32) -> u64 {
    if layer == 0 || layers <= 1 {
        return 0;
    }
    let hop = sp.plan().hop.max(1) as u64;
    let even = (hop * layer as u64) / layers as u64;
    ((even as f32) * sp.grain.layer_spread.clamp(0.0, 4.0)) as u64
}


/// Enumerate every grain in a render.
pub fn grains(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
) -> Vec<GrainEvent> {
    let sp = StreamParams {
        in_frames,
        sample_rate,
        ratio,
        semitones,
        window_ms,
        grain: *g,
        algorithm: crate::stretch::Algorithm::Granular,
        // The cloud *is* the engine here, so there is nothing to layer it over.
        cloud: false,
        cloud_mix: 0.5,
        wsola: crate::stretch::WsolaParams::default(),

        vocoder: crate::stretch::VocoderParams::default(),


        pvsola: crate::pvsola::PvsolaParams::default(),



        hybrid: crate::hybrid::HybridParams::default(),
    };
    let p = sp.plan();

    let mut out = Vec::new();
    let mut stream = GrainStream::new();
    while (stream.out_frame() as usize) < p.out_frames {
        out.push(stream.next(&sp));
    }
    out
}

/// Every grain in a render, across every layer.
///
/// [`grains`] is one schedule, and it has to stay that way: `granular` calls it
/// once per layer and builds the stack itself, so expanding layers inside it
/// would run the offline renderer layers-squared.
///
/// This is the one the *pictures* want. It ran as a single schedule for a long
/// time while the renderer ran up to sixteen, so everything drawn from it — the
/// cloud, the pad, the read band — was a sixteenth of what was being heard, and
/// a stack of layers looked like one thin stream however high it was set.
///
/// The seed and the offset come from the same helpers the real-time renderer
/// uses. Two copies of that arithmetic is how the picture and the sound drifted
/// apart in the first place.
pub fn grains_layered(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
) -> Vec<GrainEvent> {
    let mut sp = StreamParams::new(in_frames, sample_rate);
    sp.ratio = ratio;
    sp.semitones = semitones;
    sp.window_ms = window_ms;
    sp.grain = *g;

    let layers = layer_count(&sp);
    let mut out = Vec::new();
    for l in 0..layers {
        let lp = layer_params(&sp, l);
        let off = layer_offset(&sp, l, layers);
        for mut e in grains(in_frames, sample_rate, ratio, semitones, window_ms, &lp.grain) {
            e.out_frame += off;
            out.push(e);
        }
    }
    // In time order, so a caller that thins the list by striding it takes an
    // even sample across the whole render rather than all of one layer.
    out.sort_by_key(|e| e.out_frame);
    out
}

/// A sample of the schedule, without building the schedule.
///
/// The pictures never draw more than a few thousand marks, so the whole
/// enumeration was being built — ninety thousand grains on a long stretch —
/// sorted, and then four fifths of it thrown away. Every one of those discarded
/// grains cost a plan lookup and four hashes for its jitters.
///
/// A grain is a pure function of its index, so the ones that will survive can
/// simply be asked for. Each layer is walked at its own step, which keeps the
/// sample even across time *and* across layers — striding a merged list does
/// the same thing, and this arrives at it without the merge.
///
/// Returns the sample and the true total, because a picture that has been
/// thinned should be able to say so.
/// `window` is the range of output frames worth drawing, or `None` for all of
/// them. The cap is spent inside it — see the comment at the sampling step.
#[allow(clippy::too_many_arguments)]
pub fn grains_sampled(
    in_frames: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
    cap: usize,
    window: Option<(u64, u64)>,
) -> (Vec<GrainEvent>, usize) {
    let mut sp = StreamParams::new(in_frames, sample_rate);
    sp.ratio = ratio;
    sp.semitones = semitones;
    sp.window_ms = window_ms;
    sp.grain = *g;

    let layers = layer_count(&sp).max(1);
    let cap = cap.max(layers as usize);

    // How many each layer has. Every layer runs the same schedule, so this is
    // the same number for all of them — worked out once.
    let p = sp.plan();
    let hop = p.hop.max(1);
    let per_layer = if p.out_frames == 0 { 0 } else { p.out_frames.div_ceil(hop) };
    let total = per_layer * layers as usize;
    if total == 0 {
        return (Vec::new(), 0);
    }

    // The window the caller can actually see, in output frames.
    //
    // **The cap is spent here rather than across the whole document.** Sampling
    // the file evenly and then zooming in is how a cloud of three million
    // grains became three on screen: the eight thousand that survive are spread
    // over the whole length, so a window holding a thousandth of it holds eight
    // of them. Zoomed in, that was four grains against a wall of sound, which is
    // not a picture of anything.
    //
    // Given a window, the same eight thousand are spent inside it, so the
    // detail follows the zoom the way the waveform does.
    let (lo, hi) = match window {
        Some((a, b)) if b > a => (a, b.min(p.out_frames as u64)),
        _ => (0, p.out_frames as u64),
    };
    let first = (lo / hop as u64) as usize;
    let last = (hi.div_ceil(hop as u64) as usize).min(per_layer);
    let in_window = last.saturating_sub(first).max(1);

    // The step that lands on about `cap` grains altogether, within the window.
    let want_each = (cap / layers as usize).max(1);
    let step = in_window.div_ceil(want_each).max(1);

    let mut out = Vec::with_capacity(in_window.min(cap) + layers as usize);
    for l in 0..layers {
        let lp = layer_params(&sp, l);
        let off = layer_offset(&sp, l, layers);
        let mut i = first;
        while i < last {
            let write = i * hop;
            if write >= p.out_frames {
                break;
            }
            let mut e = event_at(i as u64, write, &p, &lp);
            e.out_frame += off;
            out.push(e);
            i += step;
        }
    }
    // In time order. The list is now a few thousand rather than ninety, so the
    // sort costs a fraction of what it did.
    out.sort_by_key(|e| e.out_frame);
    (out, total)
}

/// Grains produced forward from a position, reading the parameters afresh at
/// every grain.
///
/// This is the real-time counterpart to [`grains`]. It never allocates and
/// holds no audio, so it can be driven from an audio callback: ask for the next
/// grain, and whatever the sliders say *at that instant* shapes it. Holding the
/// parameters constant reproduces [`grains`] exactly, frame for frame.
///
/// There is deliberately no end. Where playback stops is the transport's
/// business, not the engine's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct GrainStream {
    index: u64,
    write: u64,
}

impl GrainStream {
    pub fn new() -> Self {
        GrainStream { index: 0, write: 0 }
    }

    /// The output frame the next grain will land on.
    pub fn out_frame(&self) -> u64 {
        self.write
    }

    /// The index the next grain will carry. Randomness derives from it.
    pub fn index(&self) -> u64 {
        self.index
    }

    /// Jump so the next grain is the one an offline render would have placed at
    /// or before `out_frame`.
    ///
    /// The index is derived from the position rather than from how many grains
    /// have been played, so seeking to a moment gives the same grains as
    /// playing to it. Without that, scrubbing would change the sound.
    pub fn seek(&mut self, out_frame: u64, sp: &StreamParams) {
        let hop = sp.plan().hop.max(1) as u64;
        self.index = out_frame / hop;
        self.write = self.index * hop;
    }

    /// The next grain, then advance by the hop the *current* parameters imply.
    pub fn next(&mut self, sp: &StreamParams) -> GrainEvent {
        let p = sp.plan();
        let e = event_at(self.index, self.write as usize, &p, sp);
        self.index += 1;
        self.write += p.hop.max(1) as u64;
        e
    }
}

/// Render `input` with independent time and pitch, grain by grain.
///
/// `ratio` is output length over input length; `semitones` the base pitch.
pub fn granular(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
) -> Vec<f32> {
    granular_with(input, channels, sample_rate, ratio, semitones, window_ms, g, None)
}

/// The same, saying how far it has got as it goes.
///
/// Reported per layer rather than per grain: a grain is a few hundred frames
/// and there are millions of them, so a tick each would cost more than it told
/// anyone. At one layer this reports once, at the end — which is honest, since
/// a one-layer granular pass has no internal boundary to report from.
#[allow(clippy::too_many_arguments)]
pub fn granular_with(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    semitones: f32,
    window_ms: f32,
    g: &Grain,
    prog: crate::Progress,
) -> Vec<f32> {
    let channels = channels.max(1);
    let in_frames = input.len() / channels;
    if in_frames == 0 {
        return Vec::new();
    }
    let p = plan(in_frames, sample_rate, ratio, window_ms, g);
    if p.out_frames == 0 {
        return Vec::new();
    }

    let tail = p.base_size * 2;
    let mut out = vec![0f32; (p.out_frames + tail) * channels];
    let mut norm = vec![0f32; p.out_frames + tail];

    // One pass per layer. Each gets its own seed, so its jitter and drift are
    // genuinely its own rather than the same cloud drawn twice, and its own
    // offset within the hop, so the layers interleave instead of stacking on
    // the same instants and merely getting louder.
    let layers = g.layers.clamp(1, 16);
    let spread = g.layer_spread.clamp(0.0, 4.0);
    let skew = g.envelope.clamp(0.0, 1.0);
    for layer in 0..layers {
        let mut lg = *g;
        if layer > 0 {
            lg.seed = g.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
        }
        lg.layer_read = g.layer_throw(layer, sample_rate);
        // One tick per layer, at the top. Reporting the layer *before* it is
        // rendered rather than after means the bar reaches full only when the
        // last layer is actually finished.
        if !crate::tick(prog, p.out_frames as u64 / layers.max(1) as u64) {
            break;
        }
        let even = ((p.hop as u64 * layer as u64) / layers as u64) as f32;
        let offset = (even * spread) as usize;

        for e in &grains(in_frames, sample_rate, ratio, semitones, window_ms, &lg) {
            let size = e.size as usize;
            // Stereo placement is per grain, so the cloud has width even from a
            // mono source. Equal power, scaled so the centre is unity and
            // turning the control up does not also turn the level down.
            let (gl, gr) = pan_gains(g, e.index, channels);
            for i in 0..size {
                let w = env_at(i, size, skew);
                let dst = e.out_frame as usize + offset + i;
                if dst >= p.out_frames + tail {
                    break;
                }
                // The grain still lands where it landed; only the direction it
                // reads its own span in is reversed.
                let step = if g.reverse { (size - 1 - i) as f32 } else { i as f32 };
                let src = e.src_frame + step * e.rate;
                for ch in 0..channels {
                    let pan = if ch == 0 { gl } else { gr };
                    out[dst * channels + ch] +=
                        sample_at(input, channels, ch, src, in_frames, g.wrap) * w * pan;
                }
                norm[dst] += w;
            }
        }
    }

    // Divide out the summed window so overlapping grains do not pile up, then
    // put back what layering takes away. Both paths call `layer_gain`; see it
    // for why the compensation is a square root.
    let lift = layer_gain(g.layers);
    // Floored at one, exactly as the live renderer floors it.
    //
    // Dividing by the summed envelope outright is right for a stretcher and
    // wrong for an emitter: a grain sounding alone becomes `(s·w)/w = s`, its
    // envelope divided straight back out, flat and clicking at both ends. That
    // was inaudible only while `hop = size / overlap` guaranteed overlap, and
    // the cloud's rate is free of the window now.
    //
    // The two paths have to agree to the sample — `engine::render` renders the
    // same schedule a block at a time and there are tests that hold it — so
    // this is not merely the same idea in both places, it is the same rule.
    for f in 0..p.out_frames {
        let n = norm[f].max(1.0);
        for ch in 0..channels {
            out[f * channels + ch] = out[f * channels + ch] / n * lift;
        }
    }
    out.truncate(p.out_frames * channels);
    out
}

/// Left and right gain for one grain's place in the stereo field.
///
/// Equal power, so a grain does not get louder as it crosses the middle, and
/// scaled by √2 so the centre is unity — turning the spread up must not also
/// turn the level down. Mono output has no field to spread across.
///
/// Public for the same reason as [`env_at`]: the real-time renderer must reach
/// the identical answer.
#[inline]
pub fn pan_gains(g: &Grain, index: u64, channels: usize) -> (f32, f32) {
    pan_gains_with(g.pan_spread, g.seed, index, channels)
}

/// The same, with the spread and seed supplied rather than read.
///
/// The real-time renderer keeps both from the moment each grain started, so a
/// hand on either control moves the grains still to come and leaves the ones
/// already in the air where they are. The seed matters as much as the spread:
/// re-seeding is meant to deal a new cloud, and a grain half way through its
/// window jumping across the stereo field is a step in the middle of a fade.
///
/// It still has to place them the way this function does, or the picture and
/// the file would disagree with what is heard — hence one implementation with
/// the two values lifted out.
pub fn pan_gains_with(spread: f32, seed: u32, index: u64, channels: usize) -> (f32, f32) {
    if channels < 2 || spread <= 1e-4 {
        return (1.0, 1.0);
    }
    let pan = spread.clamp(0.0, 1.0) * Grain { seed, ..Grain::default() }.rand_bipolar(index, 23);
    let th = (pan * 0.5 + 0.5) * std::f32::consts::FRAC_PI_2;
    (th.cos() * std::f32::consts::SQRT_2, th.sin() * std::f32::consts::SQRT_2)
}

/// Hann value at position `i` of `n`, without allocating a table per grain.
#[inline]
fn hann_at(i: usize, n: usize) -> f32 {
    if n <= 1 {
        return 1.0;
    }
    0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos()
}

/// How much steeper than a plain Hann the attack may be.
///
/// Relative rather than absolute, and the first attempt at this was absolute and
/// wrong: a 16-sample grain has to travel from silence to full and back in
/// sixteen samples, so its *Hann* moves by 0.19 a sample. Any fixed bar tight
/// enough to matter at 10 ms is one a short grain cannot meet however smooth it
/// is, and the test said so immediately.
///
/// So the question is not "how big a step" but "how much sharper than the same
/// grain unskewed", which is the comparison that makes sense at every length. At
/// four, the percussive end is still plainly an attack — four times the steepest
/// point of a Hann — without starting on a cliff.
const EDGE_SHARPNESS: f32 = 4.0;

/// The time-warping exponent, bounded so the attack cannot be a cliff.
///
/// `t^k` with `k < 1` has an **infinite derivative at zero**. That is not a
/// rounding matter: at the percussive end `k` is 0.25, and a 10 ms grain went
/// from silence at sample 0 to 39% of full scale at sample 1 — a 2 ms grain
/// reached 71%. The envelope's *value* at the edge was always zero, which is why
/// this went unnoticed; what was wrong was how fast it left. Laid down once per
/// grain at three hundred grains a second, that is a click.
///
/// So the floor is derived from the grain's own length, against the Hann of that
/// same length: a long grain may be far more abrupt in absolute terms, because
/// one sample is a much smaller part of its rise. A Hann's steepest point moves
/// by `π/(n−1)` a sample, so the bar is `EDGE_SHARPNESS · π/(n−1)`, and solving
/// `0.5 − 0.5·cos(2π·t₁^k) ≤ bar` for `k` gives the floor directly.
///
/// `k ≥ 1` — the swelling half — is returned untouched. Its slope at both edges
/// is finite already, and at `t → 1` the cosine flattens it to zero.
#[inline]
fn warp_power(n: usize, skew: f32) -> f32 {
    // 0 → ¼, ½ → 1, 1 → 4. Warping t by this power moves the peak from
    // 0.5^4 ≈ 0.06 of the way in, to 0.5^(1/4) ≈ 0.84.
    let k = 4f32.powf(skew * 2.0 - 1.0);
    if k >= 1.0 || n <= 2 {
        return k;
    }
    let bar = EDGE_SHARPNESS * std::f32::consts::PI / (n - 1) as f32;
    // A grain short enough that the bar exceeds half the envelope's whole travel
    // cannot be made smoother by any exponent, and `acos` would be asked for a
    // value outside its domain.
    if bar >= 0.5 {
        return k;
    }
    let t1 = 1.0 / (n - 1) as f32;
    let w_max = (1.0 - 2.0 * bar).acos() / (2.0 * std::f32::consts::PI);
    // Both logs are negative, so the quotient is positive; `t1 < 1` is
    // guaranteed by the `n <= 2` guard above.
    let k_min = w_max.ln() / t1.ln();
    // Never below a half, whatever the arithmetic says.
    //
    // Near the origin the envelope goes as `t^(2k−1)`, so `k = 0.5` is exactly
    // where its slope stops being infinite. Solving the discrete bound lands
    // within a few thousandths of it at every length anyway — 0.468 at 96
    // samples, 0.489 at 48,000 — so this costs nothing audible and turns "close
    // to the threshold" into "provably at or above it".
    k.max(k_min.max(0.5))
}

/// The grain envelope, with its peak moved.
///
/// Warping the position before the cosine rather than reaching for a different
/// window: the shape stays a Hann and stays smooth at both ends, but the moment
/// it peaks slides. A half is exactly [`hann_at`]; below it the peak moves early,
/// giving a fast attack and a long tail; above it the same shape runs backwards.
///
/// **How fast it may leave the edge is bounded** — see [`warp_power`]. It used to
/// say here that the shape "stays smooth at both ends — no clicks", and that was
/// measurably untrue at the percussive end for four months.
///
/// Public because the real-time renderer has its own loop and must use this
/// exact function: the picture, the playback and the exported file are three
/// separate calls, and a second implementation is how they start to disagree.
#[inline]
pub fn env_at(i: usize, n: usize, skew: f32) -> f32 {
    if (skew - 0.5).abs() < 1e-4 {
        return hann_at(i, n);
    }
    if n <= 1 {
        return 1.0;
    }
    let t = i as f32 / (n - 1) as f32;
    let warped = t.powf(warp_power(n, skew));
    0.5 - 0.5 * (2.0 * std::f32::consts::PI * warped).cos()
}

/// Linearly interpolated read, clamped at the edges.
#[inline]
fn sample_at(
    input: &[f32],
    channels: usize,
    ch: usize,
    pos: f32,
    in_frames: usize,
    wrap: bool,
) -> f32 {
    if in_frames == 0 {
        return 0.0;
    }
    // Wrapped, the end of the file joins its beginning. Clamped, a grain that
    // reads past the end holds its final sample — which is silence with a DC
    // step in front of it, and audibly not the sound.
    let p = if wrap {
        pos.rem_euclid(in_frames as f32)
    } else {
        pos.max(0.0)
    };
    let i = p.floor() as usize;
    let t = p - i as f32;
    let (a, b) = if wrap {
        (i % in_frames, (i + 1) % in_frames)
    } else {
        (i.min(in_frames - 1), (i + 1).min(in_frames - 1))
    };
    let s0 = input[a * channels + ch];
    let s1 = input[b * channels + ch];
    s0 + (s1 - s0) * t
}

#[cfg(test)]
mod jitter_symmetry {
    use super::*;

    /// Pitch jitter must be even-handed: as far sharp as it goes flat, measured
    /// in semitones, because that is the unit the control is in. A ratio is not
    /// symmetric — going up an octave doubles the rate while going down halves
    /// it — so the check has to be on the semitone offset, not on the rate.
    #[test]
    fn pitch_jitter_is_as_far_sharp_as_it_is_flat() {
        let g = Grain { pitch_jitter_semis: 6.0, seed: 7, ..Default::default() };
        let mut lo = f32::MAX;
        let mut hi = f32::MIN;
        let mut sum = 0.0f64;
        const N: u64 = 20_000;
        for i in 0..N {
            // Drift off, so this measures the jitter alone.
            let v = g.pitch_jitter_semis * g.rand_bipolar(i, 11);
            lo = lo.min(v);
            hi = hi.max(v);
            sum += v as f64;
        }
        let mean = (sum / N as f64) as f32;
        assert!(mean.abs() < 0.1, "mean offset {mean} should sit on zero");
        assert!(hi > 5.9 && hi <= 6.0, "sharpest was {hi}, wanted +6");
        assert!(lo < -5.9 && lo >= -6.0, "flattest was {lo}, wanted -6");
        assert!((hi + lo).abs() < 0.15, "lopsided: +{hi} against {lo}");
    }

    /// And the same once it has become a playback rate: a semitone up and a
    /// semitone down should be reciprocal, which is what "same amount of
    /// semitones" means in the frequency domain.
    #[test]
    fn equal_semitones_give_reciprocal_rates() {
        let up = 2f32.powf(6.0 / 12.0);
        let down = 2f32.powf(-6.0 / 12.0);
        assert!((up * down - 1.0).abs() < 1e-5, "{up} and {down} are not reciprocal");
    }

    /// Drift is centred too — but it has to be measured over enough of the
    /// underlying noise to mean anything.
    ///
    /// The first version of this sampled densely across a hundred noise nodes
    /// and read a mean of −0.066, which looks like a bias and is not: with a
    /// hundred values the standard error is already about 0.06, so the test was
    /// measuring its own sampling noise. Crossing thousands of nodes is what
    /// makes the number a statement about the generator.
    #[test]
    fn drift_is_centred_too() {
        let g = Grain { pitch_drift_semis: 8.0, drift_rate_hz: 1.0, seed: 3, ..Default::default() };
        let mut sum = 0.0f64;
        const N: usize = 200_000;
        for i in 0..N {
            // One node per tenth of a step, so this crosses 20,000 of them.
            sum += g.drift_at(i as f32 / 10.0) as f64;
        }
        let mean = (sum / N as f64) as f32;
        assert!(mean.abs() < 0.02, "drift mean {mean} should sit on zero");
    }
}

#[cfg(test)]
mod layer_tests {
    use super::*;

    fn tone(secs: f32, rate: u32) -> Vec<f32> {
        let n = (secs * rate as f32) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / rate as f32).sin())
            .collect()
    }

    fn count(g: &Grain, layers: u32) -> usize {
        let mut g = *g;
        g.layers = layers;
        // Every layer schedules its own grains, so the count is what the cloud
        // is actually made of.
        let mut total = 0;
        let l = g.layers.clamp(1, 16);
        for layer in 0..l {
            let mut lg = g;
            if layer > 0 {
                lg.seed = g.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
            }
            total += grains(48_000, 48_000, 4.0, 0.0, 60.0, &lg).len();
        }
        total
    }

    #[test]
    fn layers_multiply_the_number_of_grains() {
        let g = Grain { pitch_jitter_semis: 2.0, seed: 5, ..Default::default() };
        let one = count(&g, 1);
        assert!(one > 0);
        assert_eq!(count(&g, 4), one * 4, "four layers should be four schedules");
        assert_eq!(count(&g, 8), one * 8);
    }

    #[test]
    fn one_layer_is_exactly_what_it_always_was() {
        let g = Grain { size_jitter: 0.3, pitch_jitter_semis: 3.0, seed: 9, ..Default::default() };
        let a = granular(&tone(0.5, 48_000), 1, 48_000, 3.0, 0.0, 60.0, &g);
        let mut b = g;
        b.layers = 1;
        let c = granular(&tone(0.5, 48_000), 1, 48_000, 3.0, 0.0, 60.0, &b);
        assert_eq!(a, c, "layers of one must not change the existing sound");
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|s| s * s).sum::<f32>() / v.len().max(1) as f32).sqrt()
    }

    /// Level against layer count, relative to a single layer.
    fn levels(g: Grain) -> Vec<f32> {
        let src = tone(0.5, 48_000);
        let render = |layers: u32| {
            let mut g = g;
            g.layers = layers;
            rms(&granular(&src, 1, 48_000, 4.0, 0.0, 60.0, &g))
        };
        let one = render(1);
        [2u32, 4, 8, 16].iter().map(|l| render(*l) / one).collect()
    }

    /// The point of the control: more layers is a denser cloud, not a quieter
    /// one — and this engine used to get quieter.
    ///
    /// Sixteen jittered layers came out at 0.25, which is 1/√16 exactly: the
    /// overlap-add divides by the number of grains while decorrelated grains
    /// sum by its square root, so every doubling cost 3 dB. `layer_gain` puts
    /// it back. The test that used to stand here allowed anything between 0.4×
    /// and 2.5× and so passed the whole time the bug was there.
    #[test]
    fn layers_hold_their_level_when_the_grains_are_decorrelated() {
        let g = Grain {
            position_jitter_ms: 40.0,
            pitch_jitter_semis: 4.0,
            seed: 11,
            ..Default::default()
        };
        for (l, got) in [2u32, 4, 8, 16].iter().zip(levels(g)) {
            assert!(
                (got - 1.0).abs() < 0.2,
                "{l} layers came out at {got:.2} of one layer"
            );
        }
    }

    /// The accepted cost of the compensation, written down so it is not mistaken
    /// for a bug and quietly "fixed" back into the other one.
    ///
    /// Several layers with no jitter and no spread are the same audio several
    /// times over. Those sum coherently, so the overlap normalisation already
    /// held the level — and √N on top makes them √N too loud. The alternative
    /// was measuring the RMS to know which case we are in, which the real-time
    /// renderer cannot do without seeing audio it has not produced yet. Two
    /// paths agreeing was chosen over a measurement only one of them can take.
    #[test]
    fn identical_layers_are_deliberately_louder_and_that_is_the_trade() {
        let g = Grain { seed: 11, layer_spread: 0.0, ..Default::default() };
        for (l, got) in [2u32, 4, 8, 16].iter().zip(levels(g)) {
            let want = (*l as f32).sqrt();
            assert!(
                (got - want).abs() < 0.15,
                "{l} identical layers came out at {got:.2}, expected √{l} = {want:.2}"
            );
        }
    }

    #[test]
    fn layers_are_capped_rather_than_trusted() {
        let src = tone(0.2, 48_000);
        let g = Grain { layers: 9999, seed: 2, ..Default::default() };
        let out = granular(&src, 1, 48_000, 2.0, 0.0, 40.0, &g);
        assert!(out.iter().all(|v| v.is_finite()));
        assert!(!out.is_empty());
    }
}

#[cfg(test)]
mod widened_stereo_tests {
    use super::*;

    /// A mono source, laid across two channels, through the cloud.
    fn cloud(spread: f32) -> (Vec<f32>, usize) {
        let sr = 48_000;
        let frames = sr as usize / 2;
        // Mono, widened the way `edit::render` widens it at the read: the same
        // sample in both channels.
        let mut input = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = (i as f32 / sr as f32 * 220.0 * std::f32::consts::TAU).sin() * 0.5;
            input.push(v);
            input.push(v);
        }
        let mut g = Grain::default();
        g.pan_spread = spread;
        g.seed = 12345;
        let out = granular(&input, 2, sr, 2.0, 0.0, 60.0, &g);
        (out, 2)
    }

    fn channels_differ(out: &[f32], ch: usize) -> f32 {
        let mut worst = 0.0f32;
        for i in 0..out.len() / ch {
            worst = worst.max((out[i * ch] - out[i * ch + 1]).abs());
        }
        worst
    }

    /// **Widening alone is dual mono, and dual mono sounds mono.**
    ///
    /// Laying a mono file across two channels does not make it stereo — it makes
    /// it the same sound twice. What makes it stereo is the cloud placing each
    /// grain, and that is off until it is asked for: `pan_gains` returns unity
    /// on both sides when the spread is nought, which is the default.
    #[test]
    fn without_spread_both_channels_are_the_same_sound() {
        let (out, ch) = cloud(0.0);
        assert!(
            channels_differ(&out, ch) < 1e-6,
            "the channels differ with no pan spread asked for"
        );
    }

    /// And with it, they are genuinely apart — each grain to its own place.
    #[test]
    fn with_spread_the_grains_land_in_different_places() {
        let (out, ch) = cloud(0.8);
        let d = channels_differ(&out, ch);
        assert!(
            d > 0.01,
            "the channels are still the same sound with the spread up: worst \
             difference {d}"
        );
    }

    /// The placement is per grain and stable, not a wobble on the whole cloud:
    /// the same seed puts the same grain in the same place every time.
    #[test]
    fn a_grain_keeps_its_place() {
        let a = cloud(0.8).0;
        let b = cloud(0.8).0;
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert!((x - y).abs() < 1e-9, "the same cloud came out twice differently");
        }
    }
}
