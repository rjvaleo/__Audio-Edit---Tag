//! The Prism Core must ramp controls without allocating or taking a lock.
mod prism_pad_support {
    pub mod rt;
}
use engine::{Core, Shared, Source};
use fx::grain::StreamParams;
use prism_pad_support::rt;
use std::sync::Arc;

#[test]
fn every_declared_prism_pad_ramps_without_allocating_or_waiting() {
    rt::verify();
    audio_core::fft::prime();
    prism_grain::fft::prime();
    for entry in fx::prism::catalogue() {
        let Some(pad) = entry.descriptor.panel.pad else {
            continue;
        };
        let source = Arc::new(Source {
            samples: (0..192_000)
                .map(|i| (i as f32 * 0.02).sin() * 0.125)
                .collect(),
            channels: 1,
        });
        let params = StreamParams::new(source.samples.len(), 48_000);
        let shared = Shared::new(params, source.clone());
        let mut core = Core::new(128, 1, params, source);
        let mut rack = fx::Rack::new();
        rack.reserve_mix(128);
        rack.push(Box::new(
            fx::prism::PrismEffect::new(entry.descriptor.id, 48_000).unwrap(),
        ));
        shared.set_rack(Some(rack));
        shared.set_loop(true, 0, 192_000);
        shared.play();
        let mut audio = [0.0; 128];
        for _ in 0..64 {
            core.fill(&mut audio, 1, &shared);
        }
        let mut total = rt::Counts::default();
        for block in 0..750 {
            if block % 6 == 0 {
                let u = 0.1 + 0.8 * block as f32 / 750.0;
                for (key, (a, b)) in [(pad.x, pad.x_range), (pad.y, pad.y_range)] {
                    shared.set_manual_param(0, key, a + (b - a) * u);
                }
            }
            rt::start();
            core.fill(&mut audio, 1, &shared);
            let counts = rt::stop();
            total.alloc += counts.alloc;
            total.free += counts.free;
            total.realloc += counts.realloc;
            total.blocking += counts.blocking;
            assert!(
                audio.iter().all(|v| v.is_finite()),
                "{}",
                entry.descriptor.id
            );
        }
        rt::clean(entry.descriptor.id, total);
    }
}
