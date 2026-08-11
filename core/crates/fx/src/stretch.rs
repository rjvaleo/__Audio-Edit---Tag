//! Time stretching and pitch shifting.
//!
//! WSOLA — waveform similarity overlap-add. The signal is cut into overlapping
//! windows and reassembled at a different spacing; before each window is laid
//! down, a short search finds the nearby segment that best continues what was
//! already written. That search is the whole trick: naive overlap-add at a
//! changed hop size puts waveforms out of phase against each other and the
//! result sounds hollow and metallic.
//!
//! This is not a rack effect. Every [`crate::Effect`] must preserve buffer
//! length, and stretching exists precisely to change it, so it belongs to the
//! document rather than the chain.

/// How much work to spend looking for a good splice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    /// Short search. Fine while dragging a slider.
    Draft,
    Standard,
    /// Wide search, for the render you keep.
    Best,
}

impl Quality {
    fn search_ms(self) -> f32 {
        match self {
            Quality::Draft => 4.0,
            Quality::Standard => 10.0,
            Quality::Best => 20.0,
        }
    }
}

/// Which engine does the stretching.
///
/// Not a quality ladder — the two fail in opposite directions. WSOLA keeps
/// transients intact and smears dense polyphony; the vocoder handles polyphony
/// cleanly and smears transients. Percussion wants the first, a string pad
/// wants the second, and no amount of tuning turns either into the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    /// Waveform similarity overlap-add. Time domain.
    Wsola,
    /// Phase vocoder with identity phase locking. Frequency domain.
    Vocoder,
    /// Deterministic grain cloud. Time domain, and the only one of the three
    /// that is not trying to be transparent.
    Granular,
    /// The vocoder with a WSOLA splice every few frames, so its phase never has
    /// long enough to drift. Answers the phasiness rather than trading it away.
    Pvsola,
    /// Separate into partials, attacks and noise; stretch each with the method
    /// that suits it; sum. The expensive one, and the only one that is not
    /// applying a single compromise to material that is not one thing.
    Hybrid,
}

impl Algorithm {
    pub fn as_str(self) -> &'static str {
        match self {
            Algorithm::Wsola => "wsola",
            Algorithm::Vocoder => "vocoder",
            Algorithm::Granular => "granular",
            Algorithm::Pvsola => "pvsola",
            Algorithm::Hybrid => "hybrid",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "wsola" => Some(Algorithm::Wsola),
            "vocoder" => Some(Algorithm::Vocoder),
            "granular" => Some(Algorithm::Granular),
            "pvsola" => Some(Algorithm::Pvsola),
            "hybrid" => Some(Algorithm::Hybrid),
            _ => None,
        }
    }
}

/// The vocoder's own windowing.
///
/// Separate from WSOLA's because the two mean different things by a window. For
/// WSOLA it is a piece of waveform to splice; for the vocoder it is the
/// analysis frame, and its length is a direct trade between frequency
/// resolution and time resolution — long enough to separate two close partials
/// is already long enough to smear a snare.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VocoderParams {
    /// Analysis window in milliseconds. Sized to a power of two internally.
    pub window_ms: f32,
    /// Lock the bins around each spectral peak to that peak's phase.
    pub phase_lock: bool,

    // Everything below unpicks an assumption the algorithm normally makes.

    /// How far to believe the measured frequency deviation. Below one every
    /// partial is dragged toward the nearest bin centre, so the sound is
    /// quantised to the transform's own grid; above one the detuning is
    /// exaggerated into a warble.
    pub freq_trust: f32,
    /// How much of a peak's internal phase relationship its neighbouring bins
    /// keep. At zero every bin in a region shares one phase.
    pub phase_spread: f32,
    /// Bins a peak must beat on each side to count as one. Wide tests find few
    /// peaks, so whole bands of spectrum end up locked to one phase.
    pub peak_width: u32,
    /// Width of each peak's locked region as a fraction of the distance to its
    /// neighbours. Above one, regions overlap and a partial's phase is imposed
    /// on the one next to it.
    pub lock_width: f32,
    /// Holds magnitudes from one frame to the next. One freezes the spectrum on
    /// whatever the first frame held.
    pub mag_freeze: f32,
    /// Smears magnitudes sideways across bins.
    pub mag_blur: f32,
    /// Silences every bin below this share of the frame's loudest.
    pub mag_gate: f32,
    /// Drive every channel's phase from their sum rather than each on its own.
    ///
    /// Independent channels is the usual choice and it drifts them apart, which
    /// widens the image and hollows anything centred. Linked, each channel is
    /// moved by the same correction, so what it was doing relative to the
    /// others survives the stretch — at the price of telling two genuinely
    /// unrelated channels to agree.
    pub stereo_link: bool,
}

impl Default for VocoderParams {
    fn default() -> Self {
        // ~46 ms at 44.1 kHz, which is 2048 samples — the usual starting point,
        // and enough to resolve partials a couple of semitones apart.
        VocoderParams {
            window_ms: 46.0,
            phase_lock: true,
            freq_trust: 1.0,
            phase_spread: 1.0,
            peak_width: 2,
            lock_width: 1.0,
            mag_freeze: 0.0,
            mag_blur: 0.0,
            mag_gate: 0.0,
            stereo_link: false,
        }
    }
}

impl VocoderParams {
    pub fn is_clean(&self) -> bool {
        *self == VocoderParams::default()
    }
}

/// Which splice the similarity search goes looking for.
///
/// The search exists to find the segment that best continues what was already
/// written. Asking it for anything else is not an improvement — it is the point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Splice {
    /// Normalised correlation: the best continuation. What WSOLA is for.
    Similar,
    /// The *worst* continuation the search can find. Every splice is chosen to
    /// disagree with what came before, which is as far from waveform similarity
    /// overlap-add as the same machinery will go.
    Different,
    /// Un-normalised correlation, which grows with amplitude, so the search
    /// walks toward whatever is loudest nearby rather than whatever fits.
    Loudest,
}

impl Splice {
    pub fn as_str(self) -> &'static str {
        match self {
            Splice::Similar => "similar",
            Splice::Different => "different",
            Splice::Loudest => "loudest",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "similar" => Some(Splice::Similar),
            "different" => Some(Splice::Different),
            "loudest" => Some(Splice::Loudest),
            _ => None,
        }
    }
}

/// The envelope each window is laid down under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WinShape {
    /// Sums to a constant at 50% overlap, which is why it is the default.
    Hann,
    /// Straight sides. Sums flat too, but the corner puts a little edge on
    /// every splice.
    Triangle,
    /// No envelope at all. Every splice is a step discontinuity, so the output
    /// is peppered with clicks at the hop rate — a rhythm made of the seams.
    Rect,
}

impl WinShape {
    pub fn as_str(self) -> &'static str {
        match self {
            WinShape::Hann => "hann",
            WinShape::Triangle => "triangle",
            WinShape::Rect => "rect",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "hann" => Some(WinShape::Hann),
            "triangle" => Some(WinShape::Triangle),
            "rect" => Some(WinShape::Rect),
            _ => None,
        }
    }
}

/// WSOLA's own controls.
///
/// Everything past the first two used to be a constant in the algorithm. They
/// are constants because there are values that make WSOLA work, and the search
/// radius, the overlap and the window are exactly the three that make it stop.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WsolaParams {
    /// Hold detected transients at their original rate, letting the material
    /// around them absorb the difference.
    pub preserve_transients: bool,
    /// How eager the detector is, 0..1.
    pub sensitivity: f32,
    /// How far either side of the nominal read position to look, in
    /// milliseconds. Zero looks nowhere, which reduces WSOLA to plain
    /// overlap-add and brings back the hollow metallic phasing it exists to
    /// avoid. Large values let it wander far enough to reassemble the file out
    /// of order.
    pub search_ms: f32,
    pub splice: Splice,
    /// Frames between candidates in the search. Coarse strides quantise the
    /// choice of splice onto a grid, which is audible as a pitch.
    pub stride: u32,
    pub shape: WinShape,
    /// How much material either side of a transient is held at its original
    /// rate, in synthesis hops.
    pub guard_hops: f32,
    /// Scales the detector's absolute floor. Zero removes it.
    pub floor: f32,
}

impl Default for WsolaParams {
    fn default() -> Self {
        WsolaParams {
            preserve_transients: false,
            sensitivity: 0.5,
            // The old `Quality::Standard` search width, so a document that
            // never touches this sounds exactly as it did.
            search_ms: 10.0,
            splice: Splice::Similar,
            stride: 4,
            shape: WinShape::Hann,
            guard_hops: 3.0,
            floor: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stretch {
    /// Output length as a multiple of input length. 2.0 is twice as long.
    pub ratio: f32,
    /// Pitch shift in semitones. Does not change the length.
    pub semitones: f32,
    /// Window length. Longer smooths tonal material; shorter keeps transients.
    pub window_ms: f32,
    pub quality: Quality,
    pub algorithm: Algorithm,
    /// The vocoder's controls. Kept apart from the window above, which belongs
    /// to the time-domain engines.
    pub vocoder: VocoderParams,
    pub wsola: WsolaParams,
    /// How often PVSOLA stops trusting the propagated phase.
    pub pvsola: crate::pvsola::PvsolaParams,
    /// How the hybrid engine splits the sound up and what it does with each
    /// part.
    pub hybrid: crate::hybrid::HybridParams,
    /// Per-grain variation. Inert by default.
    pub grain: crate::Grain,
}

impl Default for Stretch {
    fn default() -> Self {
        Stretch {
            ratio: 1.0,
            semitones: 0.0,
            window_ms: 40.0,
            quality: Quality::Standard,
            algorithm: Algorithm::Wsola,
            vocoder: VocoderParams::default(),
            wsola: WsolaParams::default(),
            pvsola: crate::pvsola::PvsolaParams::default(),
            hybrid: crate::hybrid::HybridParams::default(),
            grain: crate::Grain::default(),
        }
    }
}

impl Stretch {
    pub fn is_identity(&self) -> bool {
        (self.ratio - 1.0).abs() < 1e-4
            && self.semitones.abs() < 1e-4
            && self.grain.is_clean()
    }

    /// Are the granular controls doing anything, whichever engine is selected?
    ///
    /// Kept because the interface still wants to know — it dims the grain panel
    /// when another engine is running — but it no longer decides which engine
    /// runs. That conflation is what made the picker look broken.
    pub fn grain_engaged(&self) -> bool {
        !self.grain.is_clean()
    }

    /// Are the granular controls doing anything?
    pub fn is_granular(&self) -> bool {
        !self.grain.is_clean()
    }

    /// Frequency multiplier for the pitch shift.
    pub fn pitch_factor(&self) -> f32 {
        2f32.powf(self.semitones / 12.0)
    }

    pub fn output_frames(&self, input_frames: u64) -> u64 {
        if self.is_identity() {
            return input_frames;
        }
        ((input_frames as f64) * (self.ratio.clamp(0.01, 100.0) as f64)).round() as u64
    }

    /// Stretch and shift `input` (interleaved).
    ///
    /// Pitch shifting is time stretching plus resampling: stretch by the pitch
    /// factor, then read back that much faster. The two length changes cancel,
    /// leaving the duration set by `ratio` alone.
    pub fn process(&self, input: &[f32], channels: usize, sample_rate: u32) -> Vec<f32> {
        let channels = channels.max(1);
        if input.is_empty() || channels == 0 {
            return Vec::new();
        }
        if self.is_identity() {
            return input.to_vec();
        }

        let ratio = self.ratio.clamp(0.01, 100.0);
        let pitch = self.pitch_factor().clamp(0.05, 20.0);
        let in_frames = input.len() / channels;
        let want = ((in_frames as f64) * ratio as f64).round() as usize;

        // The engine is whatever was asked for.
        //
        // This used to test `is_granular()` first and take the granular path
        // whenever any grain control was off its default — which meant the
        // engine picker silently did nothing on any document with grain
        // settings on it, and the two stretchers sounded identical because
        // neither was running. An override that cannot be seen is worse than
        // no choice at all.
        if self.algorithm == Algorithm::Granular {
            let out = crate::grain::granular(
                input, channels, sample_rate, ratio, self.semitones, self.window_ms, &self.grain,
            );
            return fit(out, want, channels);
        }

        // Stretch far enough that resampling for pitch lands on `want`.
        //
        // Both engines run under `layered`, which is inert at one layer and
        // otherwise runs the whole engine again per layer — the grain cloud's
        // idea, and nothing about it is particular to grains.
        let sr = sample_rate.max(1) as f32;
        let stretched = match self.algorithm {
            // Handled above; it returns before reaching here.
            Algorithm::Granular => unreachable!("granular returns earlier"),
            // Both of these drive the other engines rather than sitting beside
            // them, so they are not wrapped in `layered` — the layers reach
            // them through the vocoder and WSOLA runs they make internally,
            // and wrapping them here would run every layer twice.
            Algorithm::Pvsola => crate::pvsola::stretch(
                input,
                channels,
                sample_rate,
                ratio * pitch,
                self,
                self.pvsola,
            ),
            Algorithm::Hybrid => crate::hybrid::stretch(
                input,
                channels,
                sample_rate,
                ratio * pitch,
                self,
                self.hybrid,
            ),
            Algorithm::Wsola => {
                let win = (((self.window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64);
                layered(&self.grain, channels, hop_frames(&self.grain, win, sr), sample_rate, |g| {
                    wsola(
                        input,
                        channels,
                        sample_rate,
                        ratio * pitch,
                        self.window_ms,
                        self.quality,
                        self.wsola,
                        g,
                    )
                })
            }
            Algorithm::Vocoder => {
                let n = fft_size_for(self.vocoder.window_ms, sample_rate);
                layered(&self.grain, channels, hop_frames(&self.grain, n, sr), sample_rate, |g| {
                    crate::vocoder::stretch(
                        input,
                        channels,
                        ratio * pitch,
                        crate::vocoder::Settings {
                            fft_size: n,
                            phase_lock: self.vocoder.phase_lock,
                            freq_trust: self.vocoder.freq_trust,
                            phase_spread: self.vocoder.phase_spread,
                            peak_width: self.vocoder.peak_width.clamp(1, 32) as usize,
                            lock_width: self.vocoder.lock_width,
                            mag_freeze: self.vocoder.mag_freeze,
                            mag_blur: self.vocoder.mag_blur,
                            mag_gate: self.vocoder.mag_gate,
                            stereo_link: self.vocoder.stereo_link,
                            grain: *g,
                            sample_rate,
                        },
                    )
                })
            }
        };
        let out = if (pitch - 1.0).abs() < 1e-6 {
            stretched
        } else {
            resample(&stretched, channels, pitch, want)
        };

        // Hold the promised length exactly, so timeline arithmetic stays honest.
        fit(out, want, channels)
    }
}

/// Transform size for a given window length, as a power of two.
///
/// Clamped at both ends for reasons that are not cosmetic: below 256 the bins
/// are too wide to separate partials and the vocoder has nothing to lock onto,
/// and above 8192 the window is long enough that transients smear audibly no
/// matter what the phases do.
pub fn fft_size_for(window_ms: f32, sample_rate: u32) -> usize {
    let samples = (window_ms.clamp(5.0, 2000.0) / 1000.0) * sample_rate.max(1) as f32;
    (samples as usize).clamp(256, 8192).next_power_of_two()
}

fn fit(mut v: Vec<f32>, want_frames: usize, channels: usize) -> Vec<f32> {
    v.resize(want_frames * channels, 0.0);
    v
}

// ------------------------------------------------- the grain controls, shared
//
// Density, overlap, the jitters and the drift began as the grain cloud's own.
// They are not really granular ideas though — every one of these engines lays
// something down repeatedly, and every one of them therefore has a rate, a
// length, a place it reads from and a speed it reads at. So the same controls
// drive all three, and each engine answers them in its own terms: for WSOLA a
// window is a splice, for the vocoder it is an analysis frame.

/// How often a window is laid down. Density sets it outright; otherwise the
/// window is divided by how many should cover any moment.
pub fn hop_frames(g: &crate::Grain, win: usize, sr: f32) -> usize {
    if g.density_hz > 0.0 {
        ((sr / g.density_hz.clamp(0.5, 2000.0)) as usize).max(8)
    } else {
        ((win as f32) / g.overlap.clamp(1.0, 8.0)) as usize
    }
}

/// One window's length, jittered around the base.
pub(crate) fn grain_size(g: &crate::Grain, index: u64, base: usize) -> usize {
    if g.size_jitter.abs() < 1e-6 {
        return base;
    }
    let range = g.size_range.clamp(1.0, 8.0);
    let k = 1.0 + g.size_jitter.clamp(0.0, 1.0) * range * g.rand_bipolar(index, g.salt(3));
    (((base as f32) * k.clamp(0.15 / range, 2.0 * range)) as usize).max(16)
}

/// The rate one window reads at, from the pitch jitter and the drift.
pub(crate) fn grain_rate(g: &crate::Grain, index: u64, t: f32) -> f32 {
    if g.pitch_jitter_semis.abs() < 1e-6 && g.pitch_drift_semis.abs() < 1e-6 {
        return 1.0;
    }
    2f32.powf(g.pitch_offset(index, t) / 12.0).clamp(0.05, 20.0)
}

/// Where a read position lands once it has been moved off its nominal.
///
/// Clamped it piles up against the ends of the file; wrapped it comes round
/// again. Both are worth having and the difference is one control.
pub(crate) fn place(pos: f32, in_frames: usize, wrap: bool) -> usize {
    let top = (in_frames as f32 - 2.0).max(1.0);
    if wrap {
        pos.rem_euclid(top) as usize
    } else {
        pos.clamp(0.0, top) as usize
    }
}

/// Interpolated read, so a window can be laid down at a rate other than one.
#[inline]
pub(crate) fn read_at(input: &[f32], channels: usize, ch: usize, pos: f32, in_frames: usize) -> f32 {
    if in_frames == 0 {
        return 0.0;
    }
    let i = pos.floor().max(0.0) as usize;
    let f = pos - i as f32;
    let a = input[i.min(in_frames - 1) * channels + ch];
    let b = input[(i + 1).min(in_frames - 1) * channels + ch];
    a + (b - a) * f
}

/// Run an engine several times over and sum the results.
///
/// One layer is a stretcher. Several is the same source read from several
/// places at once, each with its own seed and its own offset within the hop, so
/// what comes out is denser rather than merely louder. Every engine gets this
/// the same way, because none of it depends on how the engine works.
///
/// The sum is scaled back to the level one layer produced. Which scaling is
/// right depends on how alike the layers are — identical layers want a
/// division by the count, independent ones want its square root — so rather
/// than guess, this measures.
pub(crate) fn layered<F>(
    g: &crate::Grain,
    channels: usize,
    hop: usize,
    sample_rate: u32,
    mut render: F,
) -> Vec<f32>
where
    F: FnMut(&crate::Grain) -> Vec<f32>,
{
    let layers = g.layers.clamp(1, 16);
    if layers == 1 {
        return render(g);
    }
    let spread = g.layer_spread.clamp(0.0, 4.0);
    let mut acc: Vec<f32> = Vec::new();

    for layer in 0..layers {
        let mut lg = *g;
        lg.layers = 1;
        if layer > 0 {
            lg.seed = g.seed.wrapping_add(layer.wrapping_mul(0x9E37_79B9));
        }
        lg.layer_read = g.layer_throw(layer, sample_rate);
        let v = render(&lg);
        if acc.is_empty() {
            acc = vec![0.0; v.len()];
        }
        let off = ((((hop as u64 * layer as u64) / layers as u64) as f32) * spread) as usize;
        let frames = v.len() / channels.max(1);
        for f in 0..frames {
            let d = (f + off) * channels;
            if d + channels > acc.len() {
                break;
            }
            for ch in 0..channels {
                acc[d + ch] += v[f * channels + ch];
            }
        }
    }

    // The same blind square root the grain cloud uses, and for the same reason.
    //
    // This used to measure one layer's RMS and scale the sum back to it, which
    // is exact — and impossible in an audio callback, which cannot measure
    // audio it has not produced yet. Keeping the measurement here would mean
    // the file and the transport were different sounds at every layer count
    // above one. See `crate::grain::layer_gain`.
    let lift = crate::grain::layer_gain(layers) / layers as f32;
    for s in acc.iter_mut() {
        *s *= lift;
    }
    acc
}


/// Waveform-similarity overlap-add.
/// Waveform-similarity overlap-add.
///
/// A loop over [`crate::stream::WsolaStream`], which is the same code the audio
/// callback runs. That is deliberate and it is the point: "what you hear is what
/// you export" used to be a promise kept by two implementations staying in
/// step, and is now a property of there being one.
///
/// The only thing this adds is the driving: it asks for the whole length in one
/// go where the callback asks for a few hundred frames at a time, and the
/// streamer cannot tell the difference.
fn wsola(
    input: &[f32],
    channels: usize,
    sample_rate: u32,
    ratio: f32,
    window_ms: f32,
    quality: Quality,
    params: WsolaParams,
    g: &crate::Grain,
) -> Vec<f32> {
    let in_frames = input.len() / channels;
    let sr = sample_rate.max(1) as f32;
    let want = ((in_frames as f32) * ratio).round() as usize;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }

    // The draft tier still caps the search, because this runs on every pointer
    // move and a 200 ms search per window would not keep up. The committed
    // render uses what was actually asked for.
    let mut params = params;
    if matches!(quality, Quality::Draft) {
        params.search_ms = params.search_ms.min(quality.search_ms());
    }

    let win = (((window_ms.clamp(5.0, 2000.0) / 1000.0) * sr) as usize).max(64) & !1;
    let search = ((params.search_ms.clamp(0.0, 200.0) / 1000.0) * sr) as usize;
    if in_frames <= win + search * 2 {
        // Too short to splice meaningfully; resampling alone is the honest
        // answer and avoids reading past the end.
        return resample(input, channels, 1.0 / ratio, want);
    }

    let hop = hop_frames(g, win, sr).max(1);
    let p = crate::stream::StretchParams {
        ratio,
        window_ms,
        sample_rate,
        wsola: params,
        vocoder: VocoderParams::default(),
        grain: *g,
    };

    // Driven in chunks rather than as one enormous block. The streamer sizes
    // its ring from the block it is promised, so asking for the whole length at
    // once would put a second copy of the output in memory — at a hundred times
    // a long file that is hundreds of megabytes for nothing. The block size does
    // not affect the audio; there is a test for that.
    const CHUNK: usize = 1 << 16;
    let mut s = crate::stream::WsolaStream::new(CHUNK, channels, sample_rate);
    s.set_map(crate::stream::WsolaStream::build_map(
        input, channels, sample_rate, ratio, hop, &params,
    ));
    use crate::stream::Streamer;
    s.seek(0, in_frames, &p);

    let mut out = vec![0.0; want * channels];
    let mut at = 0usize;
    while at < want {
        let n = CHUNK.min(want - at);
        s.render(&mut out[at * channels..(at + n) * channels], channels, input, &p);
        at += n;
    }
    out
}

/// Search ±`search` frames around `centre` for the segment best matching
/// `expect`, by normalised cross-correlation.
pub(crate) fn best_offset(
    input: &[f32],
    channels: usize,
    centre: usize,
    search: usize,
    expect: &[f32],
    len: usize,
    params: WsolaParams,
) -> usize {
    if search == 0 {
        // Nowhere to look. This is plain overlap-add, hollow phasing and all.
        return centre;
    }
    let lo = centre.saturating_sub(search);
    // The last position a whole window can be read from. Saturating, because
    // an input shorter than the window makes this negative — and on unsigned
    // arithmetic that is not a small number but an enormous one, which reads
    // off the end of the buffer. The offline renderer never reached here with
    // a source that short because it resampled instead; the streaming engine
    // has no such guard in front of it, and the hybrid feeds it a separated
    // part that can be shorter than anything a caller would hand over directly.
    let room = (input.len() / channels).saturating_sub(len + 1);
    if room == 0 {
        return centre.min(room);
    }
    let hi = (centre + search).min(room);
    if hi <= lo {
        return centre.min(hi);
    }

    let mut best = centre.min(hi);
    let mut best_score = f32::NEG_INFINITY;
    // Four frames by default: the correlation surface is smooth enough that a
    // finer sweep costs time without changing the choice. Coarser, and the
    // choice lands on a grid you can hear.
    let step = params.stride.clamp(1, 256) as usize;
    let mut p = lo;
    while p <= hi {
        let mut dot = 0f32;
        let mut energy = 0f32;
        for i in (0..len).step_by(2) {
            for ch in 0..channels {
                let a = input[(p + i) * channels + ch];
                let b = expect[i * channels + ch];
                dot += a * b;
                energy += a * a;
            }
        }
        // Normalising stops the search simply picking the loudest moment, which
        // is exactly why not normalising is one of the choices.
        let score = match params.splice {
            Splice::Loudest => dot,
            _ if energy > 1e-9 => dot / energy.sqrt(),
            _ => 0.0,
        };
        let score = if params.splice == Splice::Different { -score } else { score };
        if score > best_score {
            best_score = score;
            best = p;
        }
        p += step;
    }
    best
}

/// Resample by `factor` (frequency multiplier) to `want` frames, with cubic
/// interpolation. Linear interpolation is audibly gritty on pitched material.
fn resample(input: &[f32], channels: usize, factor: f32, want: usize) -> Vec<f32> {
    let in_frames = input.len() / channels;
    if in_frames == 0 || want == 0 {
        return vec![0.0; want * channels];
    }
    let mut out = vec![0f32; want * channels];
    for f in 0..want {
        let pos = f as f32 * factor;
        let i = pos.floor() as isize;
        let t = pos - i as f32;
        for ch in 0..channels {
            let s = |k: isize| -> f32 {
                let idx = (i + k).clamp(0, in_frames as isize - 1) as usize;
                input[idx * channels + ch]
            };
            out[f * channels + ch] = hermite(s(-1), s(0), s(1), s(2), t);
        }
    }
    out
}

fn hermite(m1: f32, p0: f32, p1: f32, p2: f32, t: f32) -> f32 {
    let c = (p1 - m1) * 0.5;
    let v = p0 - p1;
    let w = c + v;
    let a = w + v + (p2 - p0) * 0.5;
    let b = w + a;
    ((a * t - b) * t + c) * t + p0
}

/// The window each spliced segment is laid down under.
///

/// One value of that window, for when the length is not the same twice running
/// and there is no table to build.
#[inline]
pub(crate) fn shape_at(i: usize, n: usize, shape: WinShape, skew: f32) -> f32 {
    if n <= 1 {
        return 1.0;
    }
    // The envelope control moves where the window peaks, by warping the
    // position before the shape rather than by swapping in another shape — so
    // it stays smooth at both ends whatever it is set to, and composes with
    // the choice of shape instead of competing with it.
    let t = i as f32 / (n - 1) as f32;
    let t = if (skew - 0.5).abs() < 1e-4 { t } else { t.powf(4f32.powf(skew * 2.0 - 1.0)) };
    match shape {
        WinShape::Hann => 0.5 - 0.5 * (2.0 * std::f32::consts::PI * t).cos(),
        WinShape::Rect => 1.0,
        WinShape::Triangle => 1.0 - (t * 2.0 - 1.0).abs(),
    }
}

#[cfg(test)]
mod algorithm_tests {
    use super::*;

    fn sine(freq: f32, secs: f32, rate: f32) -> Vec<f32> {
        let n = (secs * rate) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin())
            .collect()
    }

    fn energy_at(sig: &[f32], freq: f32, rate: f32) -> f32 {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, s) in sig.iter().enumerate() {
            let p = 2.0 * std::f64::consts::PI * freq as f64 * i as f64 / rate as f64;
            re += *s as f64 * p.cos();
            im += *s as f64 * p.sin();
        }
        ((re * re + im * im).sqrt() / sig.len() as f64) as f32
    }

    fn with(alg: Algorithm, ratio: f32) -> Stretch {
        Stretch { ratio, algorithm: alg, ..Default::default() }
    }

    #[test]
    fn both_engines_honour_the_promised_length() {
        let src = sine(440.0, 0.4, 44100.0);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            for r in [0.5f32, 2.0, 5.0] {
                let out = with(alg, r).process(&src, 1, 44100);
                let want = (src.len() as f32 * r).round() as usize;
                assert_eq!(out.len(), want, "{alg:?} at {r}x");
            }
        }
    }

    #[test]
    fn both_engines_keep_the_pitch_they_were_given() {
        let rate = 44100.0;
        let src = sine(440.0, 0.4, rate);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            let out = with(alg, 3.0).process(&src, 1, 44100);
            let mid = &out[out.len() / 4..out.len() * 3 / 4];
            let sig = energy_at(mid, 440.0, rate);
            let off = energy_at(mid, 620.0, rate);
            assert!(sig > off * 6.0, "{alg:?}: 440 {sig} against 620 {off}");
        }
    }

    /// Both engines should hold a chord's partials together.
    ///
    /// This test used to assert the vocoder *beat* WSOLA here, and that was a
    /// measurement of a bug rather than of the algorithms. WSOLA advanced its
    /// read position by an integer `hop_out / ratio` every step, so the
    /// truncation accumulated and its splices drifted out of alignment. Once it
    /// followed an exact time map instead, WSOLA scored 666 on this signal
    /// against the vocoder's 421 — the ranking reversed.
    ///
    /// Which is fair: three steady sines at a fixed period is the best case a
    /// similarity search can be handed. The two engines genuinely differ on
    /// real material, but this synthetic chord does not show it, so the test
    /// now asserts only what it can honestly measure — that neither engine
    /// smears the partials into the gaps between them.
    #[test]
    fn the_vocoder_holds_a_chord_together() {
        let rate = 44100.0;
        let n = (0.5 * rate) as usize;
        let src: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / rate;
                let tau = 2.0 * std::f32::consts::PI;
                ((tau * 440.0 * t).sin() + (tau * 554.37 * t).sin() + (tau * 659.25 * t).sin()) / 3.0
            })
            .collect();

        let purity = |o: &[f32]| {
            let mid = &o[o.len() / 4..o.len() * 3 / 4];
            let sig: f32 = [440.0f32, 554.37, 659.25].iter().map(|f| energy_at(mid, *f, rate)).sum();
            let junk: f32 = [200.0f32, 330.0, 500.0, 800.0, 1100.0]
                .iter().map(|f| energy_at(mid, *f, rate)).sum();
            sig / junk.max(1e-9)
        };

        let w = purity(&with(Algorithm::Wsola, 4.0).process(&src, 1, 44100));
        let v = purity(&with(Algorithm::Vocoder, 4.0).process(&src, 1, 44100));
        assert!(v > 20.0, "vocoder smeared the chord: {v}");
        assert!(w > 20.0, "wsola smeared the chord: {w}");
    }

    #[test]
    fn the_algorithm_survives_a_round_trip_through_its_name() {
        for a in [Algorithm::Wsola, Algorithm::Vocoder] {
            assert_eq!(Algorithm::from_str(a.as_str()), Some(a));
        }
        assert_eq!(Algorithm::from_str("nonsense"), None);
    }

    #[test]
    fn the_window_control_sizes_the_transform() {
        assert!(fft_size_for(5.0, 44100) >= 256);
        assert!(fft_size_for(2000.0, 44100) <= 8192);
        assert!(fft_size_for(46.0, 44100) > fft_size_for(12.0, 44100));
        for ms in [5.0f32, 40.0, 200.0, 2000.0] {
            assert!(fft_size_for(ms, 44100).is_power_of_two());
        }
    }

    #[test]
    fn pitch_shifting_works_on_either_engine() {
        let rate = 44100.0;
        let src = sine(440.0, 0.4, rate);
        for alg in [Algorithm::Wsola, Algorithm::Vocoder] {
            let s = Stretch { semitones: 12.0, algorithm: alg, ..Default::default() };
            let out = s.process(&src, 1, 44100);
            assert_eq!(out.len(), src.len(), "{alg:?}");
            let mid = &out[out.len() / 4..out.len() * 3 / 4];
            assert!(
                energy_at(mid, 880.0, rate) > energy_at(mid, 440.0, rate) * 2.0,
                "{alg:?} did not shift up an octave"
            );
        }
    }
}
