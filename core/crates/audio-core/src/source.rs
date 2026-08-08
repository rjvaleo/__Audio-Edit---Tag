//! Random-access byte sources.
//!
//! Every parser in this crate is generic over [`RandomAccessSource`] and never
//! opens a file itself. That keeps the format and DSP layers free of platform
//! APIs, so the same code serves a local file, an in-memory buffer, or anything
//! else added later.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};

/// A seekable, readable byte source of known length.
pub trait RandomAccessSource {
    /// Read into `buf` starting at `offset`, returning the number of bytes read.
    /// A short read means end-of-source, not an error.
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize>;

    /// Total length in bytes.
    fn len(&self) -> io::Result<u64>;

    fn is_empty(&self) -> io::Result<bool> {
        Ok(self.len()? == 0)
    }

    /// Read exactly `buf.len()` bytes, or fail with `UnexpectedEof`.
    fn read_exact_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<()> {
        let mut done = 0;
        while done < buf.len() {
            let n = self.read_at(offset + done as u64, &mut buf[done..])?;
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "source ended mid-read",
                ));
            }
            done += n;
        }
        Ok(())
    }

    /// Read up to `max` bytes at `offset`, returning however many were available.
    fn read_upto(&mut self, offset: u64, max: usize) -> io::Result<Vec<u8>> {
        let mut buf = vec![0u8; max];
        let n = self.read_at(offset, &mut buf)?;
        buf.truncate(n);
        Ok(buf)
    }
}

/// A file on disk.
pub struct FileSource {
    file: File,
    len: u64,
}

impl FileSource {
    pub fn open(path: impl AsRef<std::path::Path>) -> io::Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Ok(Self { file, len })
    }
}

impl RandomAccessSource for FileSource {
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        if offset >= self.len {
            return Ok(0);
        }
        self.file.seek(SeekFrom::Start(offset))?;
        // `read` may return short for reasons other than EOF, so loop until the
        // buffer is full or the file genuinely ends.
        let mut done = 0;
        while done < buf.len() {
            match self.file.read(&mut buf[done..]) {
                Ok(0) => break,
                Ok(n) => done += n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(done)
    }

    fn len(&self) -> io::Result<u64> {
        Ok(self.len)
    }
}

/// An in-memory buffer. Used by the tests and for small files held in RAM.
pub struct SliceSource<T: AsRef<[u8]>> {
    bytes: T,
}

impl<T: AsRef<[u8]>> SliceSource<T> {
    pub fn new(bytes: T) -> Self {
        Self { bytes }
    }
}

impl<T: AsRef<[u8]>> RandomAccessSource for SliceSource<T> {
    fn read_at(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let bytes = self.bytes.as_ref();
        if offset >= bytes.len() as u64 {
            return Ok(0);
        }
        let start = offset as usize;
        let n = buf.len().min(bytes.len() - start);
        buf[..n].copy_from_slice(&bytes[start..start + n]);
        Ok(n)
    }

    fn len(&self) -> io::Result<u64> {
        Ok(self.bytes.as_ref().len() as u64)
    }
}
