//! The library catalog: what each file is, and how folders are grouped.

mod classify;
mod text;

pub use classify::{
    classify, detect_series, Category, Classification, Confidence, FileFacts, Series,
};
pub use text::{series_parts, slug, Text};
