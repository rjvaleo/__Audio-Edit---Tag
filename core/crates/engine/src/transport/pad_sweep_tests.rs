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
                    actual.aim_key(0, key, value);
                    dense.aim_key(0, key, value);
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
            CONTROL_CHUNK != 1 || (error / (FRAMES * 2) as f64).sqrt() <= 1e-9,
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
                core.aim_key(0, key, value);
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

#[test]
fn prism_pad_transport_control_measurement() {
    // Default Time & Pitch pad: logarithmic Stretch 100 down to 0.01 and
    // Pitch -48 up to +48. The fast endpoint has no timer; use a 16 ms
    // pointer stream and observe the values Core actually renders with.
    for block in [128, 512] {
        for smoothing in [0.0, 50.0] {
            let values = |u: f32| [100.0 * 0.0001_f32.powf(u), -48.0 + 96.0 * u];
            let initial = values(0.1);
            let source = Arc::new(Source {
                samples: (0..192_000)
                    .map(|i| 0.125 * (i as f32 * 0.02).sin())
                    .collect(),
                channels: 1,
            });
            let mut params = StreamParams::new(source.samples.len(), 48_000);
            params.ratio = initial[0];
            params.semitones = initial[1];
            let shared = Shared::new(params, source.clone());
            shared.set_glide(smoothing);
            shared.play();
            let mut core = Core::new(block, 1, params, source);
            let mut audio = vec![0.0; block];
            let mut previous = initial;
            let mut max_jump = [0.0_f32; 2];
            let mut changes = 0;
            let mut next_send = 0;
            for frame in (0..96_000).step_by(block) {
                if frame >= next_send {
                    let sent = frame / 768 * 768;
                    let target = values(0.1 + 0.8 * sent as f32 / 96_000.0);
                    params.ratio = target[0];
                    params.semitones = target[1];
                    shared.set_params(params);
                    next_send = sent + 768;
                }
                core.fill(&mut audio, 1, &shared);
                let now = [core.params.ratio, core.params.semitones];
                if now != previous {
                    changes += 1;
                }
                for (i, range) in [99.99, 96.0].into_iter().enumerate() {
                    max_jump[i] = max_jump[i].max((now[i] - previous[i]).abs() / range);
                }
                previous = now;
                assert!(audio.iter().all(|v| v.is_finite()));
            }
            println!("PAD_TRANSPORT block={block} smoothing={smoothing} ratio_jump={:.9} semitones_jump={:.9} changed_blocks={changes}", max_jump[0], max_jump[1]);
        }
    }
}

fn ptc_rig(block: usize, settings: PitchTime) -> (Core, Shared) {
    ptc_rig_width(block, settings, 1)
}
fn ptc_rig_width(block: usize, settings: PitchTime, channels: usize) -> (Core, Shared) {
    let source = Arc::new(Source {
        samples: (0..192_000)
            .map(|i| 0.125 * (i as f32 * 0.02).sin())
            .collect(),
        channels: 1,
    });
    let params = StreamParams::new(source.samples.len(), 48_000);
    let shared = Shared::new(params, source.clone());
    shared.set_pitch_time(settings);
    shared.play();
    (Core::new(block, channels, params, source), shared)
}

#[test]
fn prism_pad_pitch_time_changer_matches_a_per_sample_ramp() {
    const BLOCK: usize = 480;
    for channels in [1, 2] {
        let mut pt = PitchTime {
            on: true,
            speed: 20.9,
            pitch: 180.0,
            ..PitchTime::default()
        };
        let (mut core, shared) = ptc_rig_width(BLOCK, pt, channels);
        let (mut dense, dense_shared) = ptc_rig_width(1, pt, channels);
        core.fill(&mut vec![0.0; channels], channels, &shared);
        dense.fill(&mut vec![0.0; channels], channels, &dense_shared);
        let mut glide = crate::glide::Glide::default();
        glide.snap([pt.speed, pt.pitch]);
        let mut now = [pt.speed, pt.pitch];
        let mut from = now;
        let mut target = now;
        let mut at = FADER_RAMP;
        let mut previous = now;
        let mut max_jump = [0.0_f32; 2];
        let mut error = 0.0_f64;
        let mut chunk_error = 0.0_f64;
        let mut max_chunk_rms = 0.0_f64;
        let mut sampled = false;
        for frame in (0..96_000).step_by(BLOCK) {
            if frame % 2880 == 0 {
                let u = 0.1 + 0.8 * frame as f32 / 96_000.0;
                pt.speed = 1.0 + 199.0 * u;
                pt.pitch = 200.0 * (1.0 - u);
                shared.set_pitch_time(pt);
            }
            let (speed, pitch) = ptc_glided(&mut glide, &pt, true, BLOCK, 48_000);
            if [speed, pitch] != target {
                from = now;
                target = [speed, pitch];
                at = 0;
            }
            let moving = at < FADER_RAMP;
            if moving != sampled {
                dense
                    .ptc
                    .as_mut()
                    .unwrap()
                    .set_param("smoothingStep", if moving { 1.0 } else { 513.0 });
                sampled = moving;
            }
            let mut audio = vec![0.0; BLOCK * channels];
            core.fill(&mut audio, channels, &shared);
            for (f, value) in audio.chunks_exact(channels).enumerate() {
                // Independent per-sample linear interpolation of the original
                // glide targets, rather than the production PtcRamp helper.
                if at < FADER_RAMP {
                    at += 1;
                    for i in 0..2 {
                        now[i] = from[i] + (target[i] - from[i]) * at as f32 / FADER_RAMP as f32;
                    }
                    if at == FADER_RAMP {
                        now = target;
                    }
                }
                let actual = if core.ptc_moving {
                    core.ptc_curve[f]
                } else {
                    [speed, pitch]
                };
                for i in 0..2 {
                    assert!(
                        (actual[i] - now[i]).abs() < 0.00002,
                        "control {i} at {}",
                        frame + f
                    );
                }
                if (frame + f + 1) % 8 == 0 {
                    for (i, range) in [199.0, 200.0].into_iter().enumerate() {
                        max_jump[i] = max_jump[i].max((actual[i] - previous[i]).abs() / range);
                    }
                    previous = actual;
                }
                let setting = PitchTime {
                    speed: now[0],
                    pitch: now[1],
                    smoothing: 0.0,
                    ..pt
                };
                dense_shared.set_pitch_time(setting);
                // Bypass the host ramp only in this white-box reference: the
                // test already supplied its exact one-sample input controls.
                dense.ptc_now = setting;
                dense.ptc_ramp.aim(now, false);
                let mut sample = vec![0.0; channels];
                dense.fill(&mut sample, channels, &dense_shared);
                for (&a, b) in value.iter().zip(sample) {
                    assert!(a.is_finite() && b.is_finite());
                    let difference = ((a - b) as f64).powi(2);
                    error += difference;
                    chunk_error += difference;
                }
                if (frame + f + 1) % 8 == 0 {
                    max_chunk_rms = max_chunk_rms.max((chunk_error / (8 * channels) as f64).sqrt());
                    chunk_error = 0.0;
                }
            }
        }
        let rms = (error / (96_000 * channels) as f64).sqrt();
        println!("PAD_PTC_AFTER channels={channels} speed_jump_per_8={:.9} pitch_jump_per_8={:.9} rms_vs_per_sample={rms:.9} max_8_frame_rms={max_chunk_rms:.9}", max_jump[0], max_jump[1]);
        assert!(max_jump.into_iter().all(|jump| jump <= 0.00012));
        assert!(max_chunk_rms <= 0.000001);
        assert!(
            rms <= 0.000001,
            "PTC differs from per-sample reference: {rms}"
        );
    }
}

#[test]
fn prism_pad_pitch_time_changer_still_hashes() {
    for (label, pt) in [
        ("untouched", PitchTime::default()),
        (
            "corner",
            PitchTime {
                on: true,
                speed: 200.0,
                pitch: 200.0,
                ..PitchTime::default()
            },
        ),
    ] {
        let (mut core, shared) = ptc_rig(512, pt);
        let mut hash = 0xcbf29ce484222325_u64;
        for _ in 0..32 {
            let mut audio = [0.0; 512];
            core.fill(&mut audio, 1, &shared);
            for value in audio {
                for byte in value.to_bits().to_le_bytes() {
                    hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
                }
            }
        }
        let expected = if label == "untouched" {
            0xe2d997c38139db2d
        } else {
            0xc3eb331eb5c9c48c
        };
        assert_eq!(hash, expected, "PTC still setting {label} changed");
        println!("PAD_PTC_STILL {label} {hash:016x}");
    }
}

#[test]
fn a_pitch_time_ramp_maps_every_stamped_sequencer_frame_once() {
    let (mut core, shared) = ptc_rig(4, PitchTime::default());
    shared
        .seq
        .write(1, 100, &[1.0, 2.0, 3.0, 4.0, 5.0], 1, 0, None);
    core.seq_runs.push((0, 100, 5));
    core.seq_starts.push(0);
    core.seq_curved = true;
    core.ptc_positions
        .copy_from_slice(&[0.0, 0.5, 1.5, 3.0, 5.0]);
    let mut audio = [0.0; 4];
    core.mix_seq(&mut audio, 1, &shared);
    assert_eq!(audio, [1.0, 2.0, 3.0, 5.0]);
    assert_eq!(shared.seq.mixed.load(Ordering::Relaxed), 5);
    assert_eq!(shared.seq.missing.load(Ordering::Relaxed), 0);
}

#[test]
fn a_moving_pitch_time_pad_exports_what_the_live_core_plays() {
    const BLOCK: usize = 480;
    let at = |frame: u64| {
        let sent = frame.min(95_999) / 2880 * 2880;
        let u = 0.1 + 0.8 * sent as f32 / 96_000.0;
        PitchTime {
            on: true,
            speed: 1.0 + 199.0 * u,
            pitch: 200.0 * (1.0 - u),
            ..PitchTime::default()
        }
    };
    let (mut plain, plain_shared) = ptc_rig(BLOCK, PitchTime::default());
    let mut dry = vec![0.0; 144_000];
    for block in dry.chunks_mut(BLOCK) {
        plain.fill(block, 1, &plain_shared);
    }
    let (mut live, shared) = ptc_rig(BLOCK, at(0));
    let mut heard = vec![0.0; 96_000];
    for (i, block) in heard.chunks_mut(BLOCK).enumerate() {
        shared.set_pitch_time(at((i * BLOCK) as u64));
        live.fill(block, 1, &shared);
    }
    let file = pitch_time_offline(&dry, 1, 48_000, BLOCK, at);
    assert!(file.len() >= heard.len());
    for (i, (&a, &b)) in heard.iter().zip(&file).enumerate() {
        assert!(
            (a - b).abs() <= 1e-5,
            "moving PTC frame {i}: live {a}, file {b}"
        );
    }
}

/// Callback CPU cost, excluding control publication and allocation. Run alone.
#[cfg(unix)]
#[test]
#[ignore = "two-second moving eight-effect rack CPU benchmark"]
fn prism_pad_rack_chunk_cost() {
    fn cpu_ns() -> u64 {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        assert_eq!(
            unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) },
            0
        );
        t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
    }
    audio_core::fft::prime();
    prism_grain::fft::prime();
    let ids = [
        "hp-echo",
        "hp-ring-modulator",
        "sh-pitchdelay",
        "lxp-hall",
        "dattorro-plate",
        "phaser",
        "spectral-dynamics",
        "eq",
    ];
    for convolution in [false, true] {
        for block in [64, 128, 512] {
            let source = Arc::new(Source {
                samples: (0..192_000)
                    .map(|i| 0.125 * (i as f32 * 0.02).sin())
                    .collect(),
                channels: 2,
            });
            let params = StreamParams::new(96_000, 48_000);
            let shared = Shared::new(params, source.clone());
            let mut core = Core::new(block, 2, params, source);
            let mut rack = fx::Rack::new();
            rack.reserve_mix(block * 2);
            let impulse = fx::prism::Sound {
                samples: Arc::new(
                    (0..48_000)
                        .map(|i| (i as f32 * 0.071).sin() * (-6.0 * i as f32 / 48_000.0).exp())
                        .collect(),
                ),
                channels: 1,
                rate: 48_000.0,
            };
            let mut controls = Vec::new();
            for id in ids.into_iter().chain(convolution.then_some("convolution")) {
                let entry = fx::prism::catalogue()
                    .iter()
                    .find(|e| e.descriptor.id == id)
                    .unwrap_or_else(|| panic!("missing {id}"));
                let d = entry.descriptor;
                let p = d
                    .params
                    .iter()
                    .find(|p| {
                        p.kind == fx::prism::prism_fx::ParamKind::Continuous && !is_stepped(p.key)
                    })
                    .expect("continuous control");
                let slot = controls.len();
                controls.push((slot, p.key, p.min, p.max));
                let mut effect = fx::prism::PrismEffect::new(id, 48_000).unwrap();
                if id == "convolution" {
                    effect.set_sound(&impulse);
                }
                fx::Effect::set_param(&mut effect, p.key, p.min + (p.max - p.min) * 0.1);
                rack.push(Box::new(effect));
            }
            shared.set_rack(Some(rack));
            shared.set_loop(true, 0, 96_000);
            shared.play();
            let mut audio = vec![0.0; block * 2];
            for _ in 0..64 {
                core.fill(&mut audio, 2, &shared);
            }
            let mut costs = Vec::new();
            let mut next_send = 0;
            for frame in (0..96_000).step_by(block) {
                if frame >= next_send {
                    let sent = frame / 768 * 768;
                    let u = 0.1 + 0.8 * sent as f32 / 96_000.0;
                    for &(slot, key, lo, hi) in &controls {
                        shared.set_manual_param(slot, key, lo + (hi - lo) * u);
                    }
                    next_send = sent + 768;
                }
                let start = cpu_ns();
                core.fill(&mut audio, 2, &shared);
                costs.push(cpu_ns() - start);
                assert!(audio.iter().all(|v| v.is_finite()));
            }
            costs.sort_unstable();
            println!("RACK_COST chunk={} convolution={} block={} n={} median_ns={} p99_ns={} worst_ns={} controls={:?}", CONTROL_CHUNK, convolution, block, costs.len(), costs[costs.len()/2], costs[(costs.len()-1)*99/100], costs[costs.len()-1], controls);
        }
    }
}

#[test]
#[ignore = "two-second moving eight-effect rack CPU benchmark"]
fn rack_four_control_cost() {
    fn cpu_ns() -> u64 {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        assert_eq!(
            unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) },
            0
        );
        t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
    }
    audio_core::fft::prime();
    prism_grain::fft::prime();
    let ids = [
        "hp-echo",
        "hp-ring-modulator",
        "sh-pitchdelay",
        "lxp-hall",
        "dattorro-plate",
        "phaser",
        "spectral-dynamics",
        "eq",
    ];
    for convolution in [false] {
        for block in [64, 128] {
            let source = Arc::new(Source {
                samples: (0..192_000)
                    .map(|i| 0.125 * (i as f32 * 0.02).sin())
                    .collect(),
                channels: 2,
            });
            let params = StreamParams::new(96_000, 48_000);
            let shared = Shared::new(params, source.clone());
            let mut core = Core::new(block, 2, params, source);
            let mut rack = fx::Rack::new();
            rack.reserve_mix(block * 2);
            let impulse = fx::prism::Sound {
                samples: Arc::new(
                    (0..48_000)
                        .map(|i| (i as f32 * 0.071).sin() * (-6.0 * i as f32 / 48_000.0).exp())
                        .collect(),
                ),
                channels: 1,
                rate: 48_000.0,
            };
            let mut controls = Vec::new();
            for (slot, id) in ids
                .into_iter()
                .chain(convolution.then_some("convolution"))
                .enumerate()
            {
                let entry = fx::prism::catalogue()
                    .iter()
                    .find(|e| e.descriptor.id == id)
                    .unwrap_or_else(|| panic!("missing {id}"));
                let d = entry.descriptor;
                let p = d
                    .params
                    .iter()
                    .find(|p| {
                        p.kind == fx::prism::prism_fx::ParamKind::Continuous && !is_stepped(p.key)
                    })
                    .expect("continuous control");
                if slot < 4 {
                    controls.push((slot, p.key, p.min, p.max));
                }
                let mut effect = fx::prism::PrismEffect::new(id, 48_000).unwrap();
                if id == "convolution" {
                    effect.set_sound(&impulse);
                }
                fx::Effect::set_param(&mut effect, p.key, p.min + (p.max - p.min) * 0.1);
                rack.push(Box::new(effect));
            }
            shared.set_rack(Some(rack));
            shared.set_loop(true, 0, 96_000);
            shared.play();
            let mut audio = vec![0.0; block * 2];
            for _ in 0..64 {
                core.fill(&mut audio, 2, &shared);
            }
            let mut costs = Vec::new();
            let mut next_send = 0;
            for frame in (0..96_000).step_by(block) {
                if frame >= next_send {
                    let sent = frame / 768 * 768;
                    let u = 0.1 + 0.8 * sent as f32 / 96_000.0;
                    for &(slot, key, lo, hi) in &controls {
                        shared.set_manual_param(slot, key, lo + (hi - lo) * u);
                    }
                    next_send = sent + 768;
                }
                let start = cpu_ns();
                core.fill(&mut audio, 2, &shared);
                costs.push(cpu_ns() - start);
                assert!(audio.iter().all(|v| v.is_finite()));
            }
            costs.sort_unstable();
            println!("RACK_FOUR_COST chunk={} convolution={} block={} n={} median_ns={} p99_ns={} worst_ns={} controls={:?}", CONTROL_CHUNK, convolution, block, costs.len(), costs[costs.len()/2], costs[(costs.len()-1)*99/100], costs[costs.len()-1], controls);
        }
    }
}

#[cfg(unix)]
#[test]
#[ignore = "Prism pad callback CPU measurement"]
fn prism_pad_callback_cost() {
    fn cpu_ns() -> u64 {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        assert_eq!(
            unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) },
            0
        );
        t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
    }
    for entry in fx::prism::catalogue() {
        let d = entry.descriptor;
        let Some(pad) = d.panel.pad else {
            continue;
        };
        let axes = [(pad.x, pad.x_range), (pad.y, pad.y_range)];
        if axes.iter().any(|(key, _)| is_stepped(key)) {
            continue;
        }
        let initial = axes.map(|(key, (a, b))| (key, a + (b - a) * 0.1));
        for block in [64usize, 128] {
            let mut core = core_with_effect(d.id, &initial);
            core.rack.as_mut().unwrap().reserve_mix(block * 2);
            let mut out = vec![0.0; block * 2];
            let mut costs = Vec::new();
            let mut hash = 0xcbf29ce484222325u64;
            for turn in 0..1100 {
                let frame = turn * block;
                if frame % 768 < block {
                    let u = 0.1 + 0.8 * ((frame / 768 * 768) % 96000) as f32 / 96000.0;
                    for (key, (a, b)) in axes {
                        core.aim_key(0, key, a + (b - a) * u);
                    }
                }
                for (i, f) in out.chunks_exact_mut(2).enumerate() {
                    f.fill(
                        0.125
                            * (std::f32::consts::TAU * 997.0 * (frame + i) as f32 / 48000.0).sin(),
                    );
                }
                let start = cpu_ns();
                core.process_current(&mut out, 2, 48000);
                let elapsed = cpu_ns() - start;
                if turn >= 100 {
                    costs.push(elapsed);
                }
                for &sample in &out {
                    hash = (hash ^ sample.to_bits() as u64).wrapping_mul(1099511628211);
                }
            }
            costs.sort_unstable();
            println!("PAD_CALLBACK_COST id={} block={} median_ns={} p99_ns={} worst_ns={} hash={hash:016x}",d.id,block,costs[costs.len()/2],costs[(costs.len()-1)*99/100],costs[costs.len()-1]);
        }
    }
}
