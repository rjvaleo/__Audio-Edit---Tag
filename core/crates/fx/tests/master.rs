//! The channel compressor.
//!
//! One knob, so the things worth testing are the ends of it and the promise it
//! makes in between: nothing at zero, never over the ceiling at any setting,
//! and a quiet file and a loud one treated the same when the settings are
//! worked out from the material rather than given in dB.

use fx::{Effect, MasterSettings, Maximizer};

const SR: u32 = 48_000;

/// A tone with an obvious dynamic: quiet for a bar, loud for a bar.
fn dynamic(secs: f32, quiet: f32, loud: f32) -> Vec<f32> {
    let n = (secs * SR as f32) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / SR as f32;
            let amp = if (t * 2.0) as u32 % 2 == 0 { quiet } else { loud };
            (std::f32::consts::TAU * 220.0 * t).sin() * amp
        })
        .collect()
}

fn peak(v: &[f32]) -> f32 {
    v.iter().fold(0.0f32, |m, x| m.max(x.abs()))
}
fn rms(v: &[f32]) -> f32 {
    (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
}
fn db(x: f32) -> f32 {
    20.0 * x.max(1e-9).log10()
}

fn run(s: MasterSettings, input: &[f32]) -> Vec<f32> {
    squeeze(s, input).0
}

/// The audio and how far the compressor pulled it down.
///
/// Gain reduction is the honest measure of "how hard is it squeezing".
/// Crest factor is not: a fast release lets the gain back up between peaks, so
/// a harder setting can come out with a *wider* crest than a gentler one, and
/// the ceiling clamps one signal and not another depending on where the makeup
/// happened to leave it. Both of those are real compressor behaviour rather
/// than faults, which is exactly why they make a bad ruler.
fn squeeze(s: MasterSettings, input: &[f32]) -> (Vec<f32>, f32) {
    let mut v = input.to_vec();
    let mut m = Maximizer::new(s);
    // In blocks, because that is how it runs — and a processor that only works
    // when handed the whole file at once would pass a single-buffer test and
    // fail in the callback.
    for chunk in v.chunks_mut(512) {
        m.process(chunk, 1, SR);
    }
    (v, m.gain_reduction_db())
}

#[test]
fn switched_off_it_is_not_in_the_signal_path() {
    let src = dynamic(2.0, 0.05, 0.6);
    let s = MasterSettings { on: false, amount: 1.0, ..Default::default() };
    assert_eq!(run(s, &src), src);
}

#[test]
fn at_zero_it_does_nothing_even_switched_on() {
    let src = dynamic(2.0, 0.05, 0.6);
    let s = MasterSettings { on: true, amount: 0.0, ..Default::default() };
    assert_eq!(run(s, &src), src);
}

/// The one promise a maximiser has to keep.
#[test]
fn nothing_ever_gets_past_the_ceiling() {
    let src = dynamic(3.0, 0.2, 0.95);
    for amount in [0.1f32, 0.35, 0.6, 0.85, 1.0] {
        for ceiling in [-0.3f32, -3.0, -12.0] {
            let s = MasterSettings { on: true, amount, ceiling_db: ceiling, ..Default::default() };
            let out = run(s, &src);
            let limit = 10f32.powf(ceiling / 20.0);
            assert!(
                peak(&out) <= limit + 1e-6,
                "amount {amount} ceiling {ceiling}: peaked at {} dB",
                db(peak(&out))
            );
            assert!(out.iter().all(|v| v.is_finite()), "amount {amount}: NaN");
        }
    }
}

/// Turning it up must squeeze harder, monotonically. A knob whose middle is
/// gentler than its start is not one knob.
#[test]
fn more_amount_is_more_compression() {
    let src = dynamic(3.0, 0.08, 0.8);
    let mut last = -1.0f32;
    for amount in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
        let s = MasterSettings { on: true, amount, auto_level: false, ..Default::default() };
        let (_, gr) = squeeze(s, &src);
        assert!(
            gr >= last - 0.01,
            "amount {amount} squeezed less ({gr:.2} dB) than the setting below it ({last:.2} dB)"
        );
        last = gr;
    }
    assert!(last > 12.0, "at full the maximiser barely worked: {last:.2} dB");
}

/// The point of taking the threshold from the material: the same knob position
/// does the same thing to a quiet file as to a loud one.
#[test]
fn auto_compression_treats_a_quiet_file_like_a_loud_one() {
    let loud = dynamic(3.0, 0.15, 0.9);
    let quiet: Vec<f32> = loud.iter().map(|v| v * 0.05).collect(); // 26 dB down
    let s = MasterSettings { on: true, amount: 0.7, auto_level: false, ..Default::default() };

    let a = squeeze(s, &loud).1;
    let b = squeeze(s, &quiet).1;
    assert!(
        (a - b).abs() < 1.5,
        "the same setting squeezed them differently: {a:.2} dB against {b:.2} dB"
    );

    // And with a fixed threshold it must not — otherwise the test above is
    // passing for some reason other than the one it claims.
    let fixed = MasterSettings { auto_comp: false, ..s };
    let c = squeeze(fixed, &loud).1;
    let d = squeeze(fixed, &quiet).1;
    assert!(
        (c - d).abs() > 5.0,
        "a fixed threshold treated them the same too, so this proves nothing: {c:.2} against {d:.2}"
    );
}

/// Auto level is an AGC, so it needs a moment — but it must get there, and it
/// must lift a quiet file rather than leaving it where it was.
#[test]
fn auto_level_brings_a_quiet_file_up_to_the_ceiling() {
    let quiet: Vec<f32> = dynamic(6.0, 0.02, 0.05);
    let s = MasterSettings { on: true, amount: 0.6, auto_level: true, ..Default::default() };
    let out = run(s, &quiet);

    // The last second, by which time the gain has walked where it is going.
    let tail = &out[out.len() - SR as usize..];
    let reached = db(peak(tail));
    assert!(
        reached > -6.0,
        "a quiet file was left at {reached:.1} dB with auto level on"
    );
    assert!(reached <= s.ceiling_db + 1e-4, "went over the ceiling: {reached:.2} dB");
}

/// Without auto level it must still not get quieter — the makeup the curve
/// implies is applied, so turning the knob up is not a volume drop.
#[test]
fn turning_it_up_does_not_turn_it_down() {
    let src = dynamic(4.0, 0.2, 0.7);
    let plain = rms(&src);
    for amount in [0.3f32, 0.6, 1.0] {
        let s = MasterSettings { on: true, amount, auto_level: false, ..Default::default() };
        let out = rms(&run(s, &src));
        assert!(
            out > plain * 0.7,
            "at amount {amount} the level fell from {:.1} dB to {:.1} dB",
            db(plain),
            db(out)
        );
    }
}

#[test]
fn the_result_does_not_depend_on_the_block_size() {
    let src = dynamic(2.0, 0.1, 0.8);
    let s = MasterSettings { on: true, amount: 0.7, ..Default::default() };

    let one = {
        let mut v = src.clone();
        Maximizer::new(s).process(&mut v, 1, SR);
        v
    };
    let many = run(s, &src); // 512-frame blocks
    for (i, (a, b)) in one.iter().zip(many.iter()).enumerate() {
        assert!((a - b).abs() < 1e-6, "sample {i}: whole {a} against blocked {b}");
    }
}

#[test]
fn stereo_stays_put() {
    // Both channels carry the same tone a constant apart. A detector running
    // per channel would close the gap and move the image.
    let mono = dynamic(3.0, 0.1, 0.8);
    let src: Vec<f32> = mono.iter().flat_map(|v| [*v, *v * 0.5]).collect();
    let mut v = src.clone();
    let mut m = Maximizer::new(MasterSettings { on: true, amount: 0.9, ..Default::default() });
    for chunk in v.chunks_mut(1024) {
        m.process(chunk, 2, SR);
    }
    let frames = v.len() / 2;
    let mut worst = 0f32;
    for f in frames / 4..frames * 3 / 4 {
        // Skip anything the ceiling clamped, where the ratio genuinely cannot
        // hold — that is the limiter doing its job, not the detector drifting.
        if v[f * 2].abs() < 0.9 * 10f32.powf(-0.3 / 20.0) {
            worst = worst.max((v[f * 2 + 1] - v[f * 2] * 0.5).abs());
        }
    }
    assert!(worst < 0.02, "the channels drifted apart by {worst}");
}

#[test]
fn silence_stays_silent() {
    let s = MasterSettings { on: true, amount: 1.0, ..Default::default() };
    let out = run(s, &vec![0.0f32; SR as usize]);
    assert!(out.iter().all(|v| *v == 0.0), "it made something out of nothing");
}
