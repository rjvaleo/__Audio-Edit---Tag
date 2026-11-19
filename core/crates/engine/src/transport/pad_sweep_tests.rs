//! Offline measurements of the exact Core rack path used by the Prism deck.
use super::*;

fn core_with_effect(id: &str, axes: &[(&str, f32)]) -> Core {
    let params = StreamParams::new(48_000, 48_000);
    let source = Arc::new(Source {
        samples: Vec::new(),
        channels: 2,
    });
    let mut core = Core::new(1024, 2, params, source);
    let mut effect = fx::prism::PrismEffect::new(id, 48_000).unwrap();
    for &(key, value) in axes {
        fx::Effect::set_param(&mut effect, key, value);
    }
    let mut rack = fx::Rack::new();
    rack.push(Box::new(effect));
    core.rack = Some(rack);
    core
}

#[test]
fn prism_pad_rack_sweep_measurement() {
    // prismLiveParam coalesces pointer writes on a 16 ms timer. The two
    // seconds below use that cadence, not the audio callback frequency.
    const FRAMES: usize = 96_000;
    const SEND: usize = 768;
    const OBSERVE: usize = 8;
    for entry in fx::prism::catalogue() {
        let d = entry.descriptor;
        let Some(pad) = d.panel.pad else { continue };
        let axes = [(pad.x, pad.x_range), (pad.y, pad.y_range)];
        // Discrete selectors are not continuous controls to interpolate.
        if axes.iter().any(|(key, _)| is_stepped(key)) {
            continue;
        }
        let initial = axes.map(|(key, (a, b))| (key, a + (b - a) * 0.1));
        let mut actual = core_with_effect(d.id, &initial);
        let mut dense = core_with_effect(d.id, &initial);
        let mut previous = initial.map(|(_, value)| value);
        let mut jumps = [0.0_f32; 2];
        let mut error = 0.0_f64;
        for frame in (0..FRAMES).step_by(OBSERVE) {
            if frame % SEND == 0 {
                let u = 0.1 + 0.8 * frame as f32 / FRAMES as f32;
                for (key, (a, b)) in axes {
                    let value = a + (b - a) * u;
                    actual.aim(0, key, value);
                    dense.aim(0, key, value);
                }
            }
            let mut chunk = [0.0; OBSERVE * 2];
            for (i, pair) in chunk.chunks_exact_mut(2).enumerate() {
                let v =
                    0.125 * (std::f32::consts::TAU * 997.0 * (frame + i) as f32 / 48_000.0).sin();
                pair.fill(v);
            }
            let mut reference = chunk;
            actual.process_current(&mut chunk, 2, 48_000);
            for pair in reference.chunks_exact_mut(2) {
                dense.settle(1);
                dense.rack.as_mut().unwrap().process(pair, 2, 48_000);
            }
            for (i, (key, (a, b))) in axes.iter().enumerate() {
                let value = actual.rack.as_ref().unwrap().get_param(0, key).unwrap();
                jumps[i] = jumps[i].max((value - previous[i]).abs() / (b - a).abs().max(1e-12));
                previous[i] = value;
            }
            for (a, b) in chunk.into_iter().zip(reference) {
                assert!(a.is_finite() && b.is_finite(), "{} at {frame}", d.id);
                error += ((a - b) as f64).powi(2);
            }
        }
        assert!(
            (error / (FRAMES * 2) as f64).sqrt() <= 1e-9,
            "{} differs from the per-sample reference",
            d.id
        );
        for (i, (key, _)) in axes.iter().enumerate() {
            if d.spec(key)
                .is_some_and(|p| p.kind == fx::prism::prism_fx::ParamKind::Continuous)
            {
                assert!(
                    jumps[i] <= 0.00012,
                    "{} {key} jumps by {} of its range per 8 samples",
                    d.id,
                    jumps[i]
                );
            }
        }
        println!("PAD_SWEEP {} {} max_normalized_jump={:.9} {} max_normalized_jump={:.9} sends_hz=62.5 observation_hz=6000 rms_vs_per_sample={:.9}",
            d.id, pad.x, jumps[0], pad.y, jumps[1], (error / (FRAMES * 2) as f64).sqrt());
    }
}

#[test]
fn prism_pad_still_setting_hashes() {
    for entry in fx::prism::catalogue() {
        let d = entry.descriptor;
        for corner in [false, true] {
            let axes = if corner {
                match d.panel.pad {
                    Some(pad) => vec![(pad.x, pad.x_range.1), (pad.y, pad.y_range.1)],
                    None => continue,
                }
            } else {
                Vec::new()
            };
            let mut core = core_with_effect(d.id, &axes);
            // A parked pad has already sent its controls; aim must remain
            // inert when their current and target values are identical.
            for &(key, _) in &axes {
                let value = core.rack.as_ref().unwrap().get_param(0, key).unwrap();
                core.aim(0, key, value);
            }
            let mut hash = 0xcbf29ce484222325_u64;
            for block in 0..32 {
                let mut audio = [0.0; 1024];
                for (i, sample) in audio.iter_mut().enumerate() {
                    *sample = 0.125
                        * (std::f32::consts::TAU * 997.0 * (block * 512 + i / 2) as f32 / 48_000.0)
                            .sin();
                }
                core.process_current(&mut audio, 2, 48_000);
                for value in audio {
                    for byte in value.to_bits().to_le_bytes() {
                        hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
                    }
                }
            }
            let line = format!(
                "PAD_STILL {} {} {hash:016x}",
                d.id,
                if corner { "corner" } else { "untouched" }
            );
            assert!(
                include_str!("../../tests/fixtures/prism_pad_still.txt")
                    .lines()
                    .any(|expected| expected == line),
                "still setting changed: {line}"
            );
            println!("{line}");
        }
    }
}
