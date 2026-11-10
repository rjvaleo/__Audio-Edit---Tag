//! Pan, meters, the master analyser and the grains view.

use super::*;

/// Where a grain sits across the stereo field, as -1 to 1.
///
/// Derived from `pan_gains`, which is what actually places it, rather than
/// re-deriving the randomness here: the two would drift, and a picture that
/// disagrees with the sound about which side a grain is on is worse than one
/// that does not show the side at all.
fn pan_of(g: &fx::Grain, index: u64) -> f32 {
    let (l, r) = fx::grain::pan_gains(g, index, 2);
    // Equal power either side of centre: the pair is (cos, sin) of an angle
    // running a quarter turn, so their difference over their sum runs the
    // field. At no spread both are one and this is zero.
    let sum = l + r;
    if sum <= 1e-6 {
        0.0
    } else {
        ((r - l) / sum).clamp(-1.0, 1.0)
    }
}

// ─────────────────────────────────────────────────────────── the master bus ──
//
// See `docs/MASTER-BUS.md`. The audio callback copies L and R into a ring and
// does nothing else with them; everything below happens here, on a thread that
// is allowed to take as long as it likes.

/// Points in the goniometer trace. About 21 ms at 48 kHz — a short window of
/// *every* sample, because a Lissajous decimated is a picture of a different,
/// aliased signal.
pub(super) const LISSAJOUS_POINTS: usize = 1024;

/// The master analyser's transform, when the caller does not say.
///
/// 11.7 Hz per bin at 48 kHz, against the 43 Hz of the 1024-point one that used
/// to run in the callback. The caller can ask for more: the ring holds
/// [`engine::transport::SCOPE_FRAMES`], so 16,384 is the largest transform
/// there is data for, and it is the ceiling here.
const MASTER_FFT: usize = 4096;
const MASTER_FFT_MIN: usize = 256;
const MASTER_FFT_MAX: usize = 16_384;

/// Bands in the published spectrum, when the caller does not say. Geometric
/// from 20 Hz to 20 kHz, so an octave takes the same width wherever it sits.
///
/// The interface asks for one band per pixel of the display it is about to draw
/// into, which is as much detail as can be seen and no more.
pub(super) const MASTER_BANDS: usize = 256;
pub(super) const MASTER_BANDS_MIN: usize = 24;
pub(super) const MASTER_BANDS_MAX: usize = 2048;
pub(super) const MASTER_LO_HZ: f32 = 20.0;
pub(super) const MASTER_HI_HZ: f32 = 20_000.0;

/// Two decimal places is a tenth of a pixel on any meter anyone will draw, and
/// it keeps the goniometer's thousand pairs to a few kilobytes instead of
/// thirty.
fn round2(v: f32) -> f64 {
    ((v * 100.0).round() / 100.0) as f64
}

/// Four places, for the numbers a *shape* is drawn from.
///
/// **Two places is a staircase.** A Lissajous coordinate runs about −1 to 1, so
/// rounding it to hundredths leaves two hundred possible values — and the ring's
/// radius is built from those, then multiplied by the drive. Turn the drive up
/// and the rounding is multiplied with everything else, so the ring comes out as
/// a run of flat arcs with a step between each one. It reads as low resolution
/// and no amount of interpolation on the other side can help: a smooth curve
/// through a staircase is still a staircase.
///
/// Two places is fine for a number that is going to be *printed*. It is not fine
/// for one that is going to be drawn. The cost of the extra two is about four
/// kilobytes a poll over the loopback.
fn round4(v: f32) -> f64 {
    ((v * 10_000.0).round() / 10_000.0) as f64
}

fn channel_json(c: &audio_core::meter::Channel) -> Value {
    Value::obj()
        .set("vu", c.vu as f64)
        .set("vuDb", c.vu_db as f64)
        .set("vuUnits", c.vu_units as f64)
        .set("peak", c.peak as f64)
        .set("peakDb", c.peak_db as f64)
}

/// What the master bus is doing right now.
///
/// `live: false` whenever there is nothing to report — no device, or nothing
/// has played yet. Never an error: a meter that 503s is a meter that fills the
/// log while telling the interface nothing it can act on.
pub(super) fn api_engine_master(app: &Arc<App>, req: &Request) -> Response {
    // The snapshot is taken under the locks and the arithmetic is done outside
    // them. A 4096-point transform must never be holding something the audio
    // thread is about to want.
    let want_pre = req.param("pre") == Some("1");
    let snap = crate::live::peek(app, |h| {
        if want_pre {
            // Two seconds of the ring for each ask: the effects page polls far
            // faster than that, and nothing need tell the engine when it shuts.
            h.shared.want_pre_rack(h.sample_rate.saturating_mul(2));
        }
        let pre = if want_pre { h.shared.pre_rack_snapshot().map(|p| (p, h.shared.output_gain())) } else { None };
        h.shared.scope_snapshot().map(|s| (s, pre))
    })
    .flatten();
    let Some(((l, r, rate), pre)) = snap else {
        return Response::json(Value::obj().set("live", false).to_string());
    };

    // The display says how much detail it wants. `fft` is rounded down to a
    // power of two rather than rejected, so a caller asking for 3000 gets 2048
    // and a picture, not a 400 and none.
    let fft = req
        .param("fft")
        .and_then(|v| v.parse::<usize>().ok())
        .map(|n| {
            let n = n.clamp(MASTER_FFT_MIN, MASTER_FFT_MAX);
            1usize << (usize::BITS - 1 - n.leading_zeros()) as usize
        })
        .unwrap_or(MASTER_FFT);
    let nbands = req
        .param("bands")
        .and_then(|v| v.parse::<usize>().ok())
        .map(|n| n.clamp(MASTER_BANDS_MIN, MASTER_BANDS_MAX))
        .unwrap_or(MASTER_BANDS);

    let m = audio_core::meter::master(&l, &r, rate, fx::CEILING_KNEE);
    let bands =
        audio_core::meter::spectrum(&l, &r, rate, fft, nbands, MASTER_LO_HZ, MASTER_HI_HZ);
    let pts = audio_core::meter::lissajous(&l, &r, LISSAJOUS_POINTS);

    // Flat, and interleaved. A thousand `[l, r]` arrays is twice the JSON of a
    // thousand pairs of numbers and says exactly the same thing.
    let flat = |pts: &[(f32, f32)]| {
        let mut xy = Vec::with_capacity(pts.len() * 2);
        for (a, b) in pts {
            xy.push(Value::Num(round4(*a)));
            xy.push(Value::Num(round4(*b)));
        }
        xy
    };
    let xy = flat(&pts);

    // The same two pictures of what reached the rack. Brought to the output
    // fader, which is after the chain, so the two differ only by the effects.
    let pre = pre.map(|((mut pl, mut pr, prate), gain)| {
        pl.iter_mut().chain(pr.iter_mut()).for_each(|v| *v *= gain);
        let bands = audio_core::meter::spectrum(&pl, &pr, prate, fft, nbands, MASTER_LO_HZ, MASTER_HI_HZ);
        Value::obj()
            .set("spectrum", Value::Arr(bands.into_iter().map(|v| Value::Num(round4(v))).collect()))
            .set("lissajous", Value::Arr(flat(&audio_core::meter::lissajous(&pl, &pr, LISSAJOUS_POINTS))))
    });

    let reply =
        Value::obj()
            .set("live", true)
            .set("rate", rate as f64)
            .set("frames", m.frames as f64)
            .set("left", channel_json(&m.left))
            .set("right", channel_json(&m.right))
            .set("correlation", m.correlation as f64)
            // How much of the last hundred milliseconds the output stage is
            // rounding off. Zero means the soft ceiling is not doing anything.
            .set("overKnee", m.over_knee as f64)
            .set("vuRef", audio_core::meter::VU_REF_DBFS as f64)
            // What was actually used, which is not always what was asked for.
            .set("fft", fft as f64)
            .set("bins", (rate as f64) / fft as f64)
            .set("knee", fx::CEILING_KNEE as f64)
            .set("lo", MASTER_LO_HZ as f64)
            .set("hi", MASTER_HI_HZ as f64)
            .set(
                "spectrum",
                // The terrain is drawn from these, and drawn geometry wants the
                // same precision the ring does — a floor built from hundredths
                // has the same steps in it, they are just harder to see edge-on.
                Value::Arr(bands.into_iter().map(|v| Value::Num(round4(v))).collect()),
            )
            .set("lissajous", Value::Arr(xy));
    Response::json(match pre { Some(p) => reply.set("pre", p), None => reply }.to_string())
}

/// The grain schedule for the visualiser.
///
/// Computed from the same enumeration the renderer uses, so the picture cannot
/// show grains the audio does not contain. No audio is read.
pub(super) fn api_grains(app: &Arc<App>, req: &Request) -> Response {
    let Some(rel) = req.param("p") else {
        return Response::error(400, "no path given");
    };
    let Some(list) = app.edits.snapshot(rel) else {
        return Response::json(Value::obj().set("grains", Value::Arr(vec![])).to_string());
    };
    let st = list.stretch;
    // Only the grains that will actually be sent are built. A grain is a pure
    // function of its index, so there is no need to enumerate ninety thousand
    // of them and throw four fifths away — every discarded one cost a plan
    // lookup and four hashes for its jitters. See `grains_sampled`.
    let cap = app.grain_cap.read().map(|g| *g).unwrap_or(8_000).max(1);
    // The visible range, if the caller said what it is looking at. The cap is
    // spent inside it, so zooming in buys detail instead of losing it.
    let window = match (
        req.param("from").and_then(|v| v.parse::<u64>().ok()),
        req.param("to").and_then(|v| v.parse::<u64>().ok()),
    ) {
        (Some(a), Some(b)) if b > a => Some((a, b)),
        _ => None,
    };
    let (sent, total) = fx::grain::grains_sampled(
        list.base_frames() as usize,
        list.sample_rate,
        st.ratio,
        st.semitones,
        st.window_ms,
        &st.grain,
        cap,
        window,
    );

    // Cap what crosses the wire. Three thousand was a cap from when this fed an orbit of a few dozen
    // visible dots. The cloud draws every grain in its time window, so thinning
    // five to one made a dense cloud look like a thin one — the same complaint
    // the single-layer enumeration caused, arriving by a second route. Twenty
    // thousand grains is about a megabyte of JSON, once per edit, on a loopback
    // socket; the cap is still here because a long file at sixteen layers and
    // five hundred a second is millions and nothing can draw those.
    // What the interface says when it tells you the picture has been thinned.
    let stride = if sent.is_empty() { 1 } else { (total / sent.len()).max(1) };

    // Measure what each grain actually sounds like, not just where it sits.
    // The visualiser is meant to be driven by the audio, so amplitude and
    // brightness come from the source window the grain reads, not from a
    // stand-in derived from the parameters.
    // From the cache. The audio in a file does not change, so decoding it again
    // on every request — eleven times a second while a slider moves — was the
    // largest single cost in here.
    let source = app
        .library_path()
        .and_then(|lib| resolve_within(&lib, rel))
        .and_then(|p| app.decoded_source(rel, &p));

    let measure = |start: f32, len: usize| -> (f32, f32) {
        let Some((buf, ch)) = &source else { return (0.0, 0.0) };
        let frames = buf.len() / ch;
        let a = (start as usize).min(frames.saturating_sub(1));
        let b = (a + len).min(frames);
        if b <= a + 1 {
            return (0.0, 0.0);
        }
        // Every eighth frame is plenty for a display value and keeps a dense
        // grain stream from turning into a full second of arithmetic.
        let mut sum = 0f64;
        let mut n = 0u32;
        let mut crossings = 0u32;
        let mut prev = 0f32;
        for f in (a..b).step_by(8) {
            let v = buf[f * ch];
            sum += (v as f64) * (v as f64);
            if prev <= 0.0 && v > 0.0 {
                crossings += 1;
            }
            prev = v;
            n += 1;
        }
        let rms = if n > 0 { (sum / n as f64).sqrt() as f32 } else { 0.0 };
        // Zero-crossing rate as a cheap brightness proxy: no FFT per grain.
        let brightness = if n > 1 { crossings as f32 / n as f32 } else { 0.0 };
        (rms, brightness.min(1.0))
    };

    let arr: Vec<Value> = sent
        .iter()
        .map(|e| {
            let (rms, bright) = measure(e.src_frame, e.size as usize);
            // Rounded to what a picture can use. These were going out at full
            // precision — seventeen digits to place a dot on a canvas a few
            // hundred pixels wide — and a grain's worth of that is most of the
            // payload. A frame is a whole number; a hundredth of a frame is
            // already far finer than any pixel.
            let r2 = |v: f32, places: i32| -> f64 {
                let m = 10f64.powi(places);
                (v as f64 * m).round() / m
            };
            Value::Arr(vec![
                Value::Num(e.out_frame as f64),
                Value::Num(r2(e.src_frame, 2)),
                Value::Num(e.size as f64),
                Value::Num(r2(e.pitch_semis, 3)),
                Value::Num(r2(rms, 4)),
                Value::Num(r2(bright, 4)),
                // Where this grain sits across the stereo field, from the same
                // function that places it in the audio. The cloud needs a
                // left-and-right that is real rather than decorative, and this
                // is the only one a grain has.
                Value::Num(r2(pan_of(&st.grain, e.index), 3)),
                // The grain's own index. Every jitter it carries is a pure
                // function of this number, and the braid needs it to work out
                // which strand a grain belongs to — an ordinal in the array
                // would change meaning the moment the list is thinned.
                Value::Num(e.index as f64),
            ])
        })
        .collect();

    Response::json(
        Value::obj()
            .set("grains", Value::Arr(arr))
            .set("total", total)
            .set("shown", sent.len())
            .set("outFrames", list.frames())
            .set("srcFrames", list.base_frames())
            .set("sampleRate", list.sample_rate)
            .set("granular", st.is_granular())
            .to_string(),
    )
}
