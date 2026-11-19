//! Every physical model, held at A4, across device rates and block sizes.
#[path = "../../engine/tests/stage1_support/matrix.rs"]
mod matrix;
use atmos::{models::MODELS, Synth};
use matrix::Deviation;
#[rustfmt::skip]
const ALLOW: &[Deviation] = &[
    Deviation { name: "pluck", rate: 96000, block: 16, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "pluck", rate: 96000, block: 64, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "pluck", rate: 96000, block: 480, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "pluck", rate: 96000, block: 512, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "pluck", rate: 96000, block: 1024, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "pluck", rate: 96000, block: 4096, metric: "dB", measured: 4.330016, why: "Fixed per-sample damping and body excitation change the 0.25-0.5 s decay level (atmos/models.rs:200)." },
    Deviation { name: "bow", rate: 44100, block: 16, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 44100, block: 64, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 44100, block: 480, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 44100, block: 512, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 44100, block: 1024, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 44100, block: 4096, metric: "dB", measured: -8.932981, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 16, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 64, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 480, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 512, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 1024, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "bow", rate: 96000, block: 4096, metric: "dB", measured: 4.993915, why: "Fixed bridge loss and low-pass coefficient change the driven string level (atmos/models.rs:219)." },
    Deviation { name: "pipe", rate: 44100, block: 16, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 16, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 64, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 64, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 480, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 480, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 512, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 512, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 1024, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 1024, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 4096, metric: "cents", measured: -146.706900, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 44100, block: 4096, metric: "dB", measured: 0.712504, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 16, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 64, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 480, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 512, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 1024, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "pipe", rate: 96000, block: 4096, metric: "dB", measured: -4.414001, why: "Fixed bore loss/jet delays change level; near-DC strongest peak is limited by FFT-bin resolution (atmos/models.rs:346)." },
    Deviation { name: "reed", rate: 96000, block: 16, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
    Deviation { name: "reed", rate: 96000, block: 64, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
    Deviation { name: "reed", rate: 96000, block: 480, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
    Deviation { name: "reed", rate: 96000, block: 512, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
    Deviation { name: "reed", rate: 96000, block: 1024, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
    Deviation { name: "reed", rate: 96000, block: 4096, metric: "dB", measured: 0.747869, why: "Fixed reed/bell filtering changes steady level (atmos/models.rs:372)." },
];
#[test]
fn every_atmosphere_model_at_every_rate_and_block() {
    let names: Vec<_> = MODELS.iter().map(|m| m.0).collect();
    matrix::run(&names, ALLOW, |name, rate, block| {
        let model = MODELS.iter().position(|m| m.0 == name).unwrap();
        let mut synth = Synth::new(rate as f32);
        synth.set("a.model", model as f32);
        synth.set("b.model", model as f32);
        for side in ["a", "b"] {
            for (i, &v) in MODELS[model].3.iter().enumerate() {
                synth.set(&format!("{side}.p{i}"), v);
            }
        }
        synth.set("atk", 0.002);
        synth.set("sus", 1.0);
        synth.set("drift", 0.0);
        synth.set("width", 0.0);
        synth.note_on(1, 440.0, 0.8, 0);
        let mut l = vec![0.0; rate as usize / 2];
        let mut r = l.clone();
        for (a, b) in l.chunks_mut(block).zip(r.chunks_mut(block)) {
            synth.render(a, b);
        }
        assert!(r.iter().all(|x| x.is_finite()));
        l
    });
}
