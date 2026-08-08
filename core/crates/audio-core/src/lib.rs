//! Audio format probing, decoding and measurement.
//!
//! This crate touches no platform APIs beyond `std::fs` in [`source::FileSource`],
//! and every parser is generic over [`RandomAccessSource`]. Nothing loads a whole
//! file into memory.

pub mod fft;
mod probe;
mod reader;
mod source;
pub mod spectrum;
pub mod wav;

pub use probe::{raw_info, AudioInfo, Codec, Container, Endian, ProbeError};
pub use reader::{Column, PeakTile, Reader, Stats};
pub use spectrum::Spectrogram;
pub use source::{FileSource, RandomAccessSource, SliceSource};

pub use probe::probe;

/// Open a file, probe it, and return a reader positioned over its samples.
pub fn open(path: impl AsRef<std::path::Path>) -> Result<Reader<FileSource>, ProbeError> {
    let mut src = FileSource::open(path)?;
    let info = probe(&mut src)?;
    Ok(Reader::new(src, info))
}
