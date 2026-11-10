//! The edit engine's contract.
//!
//! Every test renders and inspects actual samples rather than asserting on the
//! clip list, because the clip list is an implementation detail and the samples
//! are what the user hears.

use audio_core::{AudioInfo, Codec, Container, Endian, Reader, SliceSource};
use edit::render::{measure_peak, render, render_to_wav};
use edit::{EditList, FadeShape, Range, Session};

/// A source whose sample value equals its frame index divided by 1000, so any
/// frame can be identified from its value alone.
fn ramp_reader(frames: usize, channels: u16) -> Reader<SliceSource<Vec<u8>>> {
    let mut bytes = Vec::new();
    for i in 0..frames {
        for ch in 0..channels {
            let v = i as f32 / 1000.0 + ch as f32 * 0.5;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
    }
    let len = bytes.len() as u64;
    Reader::new(
        SliceSource::new(bytes),
        AudioInfo {
            container: Container::Raw,
            codec: Codec::PcmF32,
            endian: Endian::Little,
            sample_rate: 1000,
            channels,
            bits: 32,
            data_offset: 0,
            data_len: len,
        },
    )
}

fn identity(frames: u64) -> EditList {
    EditList::identity(frames, 1, 1000)
}

fn rendered(list: &EditList, reader: &mut Reader<SliceSource<Vec<u8>>>) -> Vec<f32> {
    render(list, reader, 0, list.frames()).expect("render")
}

use fx::comp::CompSettings;
use fx::eq::{Band, EqSettings};
use fx::{Compressor, Eq, Gain, Rack};

mod basics;
mod effects;
mod peak_edits;
use peak_edits::*;
mod aiff_copy;
