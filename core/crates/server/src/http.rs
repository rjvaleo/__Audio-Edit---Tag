//! Minimal HTTP/1.1 request parsing and response building.
//!
//! Hand-rolled rather than pulled from crates.io so the binary cross-compiles
//! with no external dependencies. It serves exactly one client — a browser on
//! localhost — so it implements what that needs and nothing more.

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read};

#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub method: String,
    /// Path with percent-escapes already decoded.
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(|s| s.as_str())
    }

    pub fn param(&self, name: &str) -> Option<&str> {
        self.query.get(name).map(|s| s.as_str())
    }

    /// Query parameter parsed as a number, falling back to `default`.
    pub fn number<T: std::str::FromStr>(&self, name: &str, default: T) -> T {
        self.param(name).and_then(|v| v.parse().ok()).unwrap_or(default)
    }
}

/// Cap on request size. A tag-edit payload is a few kilobytes; anything vastly
/// larger is a mistake or an attack, and refusing it keeps memory bounded.
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_HEADER_LINES: usize = 100;

pub fn parse_request<R: Read>(stream: R) -> io::Result<Request> {
    let mut r = BufReader::new(stream);

    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut parts = line.trim_end().split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();
    if method.is_empty() || target.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "malformed request line"));
    }

    let mut headers = HashMap::new();
    for _ in 0..MAX_HEADER_LINES {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0u8; len.min(MAX_BODY)];
    if !body.is_empty() {
        r.read_exact(&mut body)?;
    }

    let (raw_path, raw_query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    Ok(Request {
        method,
        path: percent_decode(raw_path),
        query: parse_query(raw_query),
        headers,
        body,
    })
}

pub fn parse_query(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in raw.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(percent_decode(k), percent_decode(v));
    }
    out
}

/// Decode percent-escapes and `+`.
///
/// Invalid escapes are passed through literally rather than dropped, so a
/// filename containing a stray `%` still resolves.
pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A parsed `Range: bytes=a-b` header, resolved against a known total length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    /// Inclusive.
    pub end: u64,
}

impl ByteRange {
    pub fn len(&self) -> u64 {
        self.end.saturating_sub(self.start) + 1
    }
}

/// Parse a single byte range. Returns `None` when the header is absent or
/// unusable, and the caller should send the whole resource.
///
/// Handles the suffix form (`bytes=-500`, meaning the last 500 bytes) because
/// Safari uses it when seeking near the end of a file.
pub fn parse_range(header: &str, total: u64) -> Option<ByteRange> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // Multi-range requests are legal but no browser uses them for media; take
    // the first and let the rest be.
    let spec = spec.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;

    if total == 0 {
        return None;
    }

    let range = if a.is_empty() {
        // Suffix form: the last N bytes.
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        ByteRange {
            start: total.saturating_sub(n),
            end: total - 1,
        }
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            total - 1
        } else {
            b.parse::<u64>().ok()?.min(total - 1)
        };
        ByteRange { start, end }
    };

    // A start past the end is unsatisfiable.
    if range.start >= total || range.start > range.end {
        return None;
    }
    Some(range)
}

pub struct Response {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    pub extra: Vec<(String, String)>,
}

impl Response {
    pub fn new(status: u16, content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type: content_type.to_string(),
            body,
            extra: Vec::new(),
        }
    }

    pub fn ok(content_type: &str, body: Vec<u8>) -> Self {
        Self::new(200, content_type, body)
    }

    pub fn json(body: String) -> Self {
        Self::new(200, "application/json; charset=utf-8", body.into_bytes())
    }

    pub fn text(status: u16, msg: &str) -> Self {
        Self::new(status, "text/plain; charset=utf-8", msg.as_bytes().to_vec())
    }

    /// A JSON error body, so the browser gets the same shape whatever happens.
    pub fn error(status: u16, msg: &str) -> Self {
        let escaped = crate::json::escape(msg);
        let mut r = Self::new(
            status,
            "application/json; charset=utf-8",
            format!("{{\"error\":\"{escaped}\"}}").into_bytes(),
        );
        r.status = status;
        r
    }

    pub fn with(mut self, k: &str, v: &str) -> Self {
        self.extra.push((k.to_string(), v.to_string()));
        self
    }

    pub fn to_bytes(&self, include_body: bool) -> Vec<u8> {
        let reason = match self.status {
            200 => "OK",
            206 => "Partial Content",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            416 => "Range Not Satisfiable",
            500 => "Internal Server Error",
            _ => "OK",
        };
        let mut head = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\n",
            self.status,
            reason,
            self.content_type,
            self.body.len()
        );
        for (k, v) in &self.extra {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
        head.push_str("\r\n");
        let mut out = head.into_bytes();
        if include_body {
            out.extend_from_slice(&self.body);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_get() {
        let raw = "GET /api/folders HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let r = parse_request(raw.as_bytes()).unwrap();
        assert_eq!(r.method, "GET");
        assert_eq!(r.path, "/api/folders");
        assert_eq!(r.header("host"), Some("localhost"));
    }

    #[test]
    fn header_lookup_is_case_insensitive() {
        let raw = "GET / HTTP/1.1\r\nCoNtEnT-TyPe: text/plain\r\n\r\n";
        let r = parse_request(raw.as_bytes()).unwrap();
        assert_eq!(r.header("content-type"), Some("text/plain"));
        assert_eq!(r.header("Content-Type"), Some("text/plain"));
    }

    #[test]
    fn parses_a_post_body() {
        let raw = "POST /api/save HTTP/1.1\r\nContent-Length: 7\r\n\r\n{\"a\":1}";
        let r = parse_request(raw.as_bytes()).unwrap();
        assert_eq!(r.method, "POST");
        assert_eq!(r.body, b"{\"a\":1}");
    }

    #[test]
    fn decodes_percent_escapes_in_paths_and_queries() {
        let raw = "GET /audio?p=Even%20More%2FDa%20Heat%2Fkick%201.wav HTTP/1.1\r\n\r\n";
        let r = parse_request(raw.as_bytes()).unwrap();
        assert_eq!(r.param("p"), Some("Even More/Da Heat/kick 1.wav"));
    }

    #[test]
    fn decodes_non_ascii_filenames() {
        // The archive has files with accented and non-Latin names.
        assert_eq!(percent_decode("caf%C3%A9"), "café");
    }

    #[test]
    fn a_stray_percent_is_passed_through_not_dropped() {
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
    }

    #[test]
    fn plus_means_space_in_a_query() {
        assert_eq!(percent_decode("kick+1"), "kick 1");
    }

    #[test]
    fn a_query_value_containing_an_equals_sign_survives() {
        let q = parse_query("a=1&b=x=y");
        assert_eq!(q.get("b").map(|s| s.as_str()), Some("x=y"));
    }

    #[test]
    fn a_malformed_request_line_is_rejected() {
        assert!(parse_request(&b"\r\n\r\n"[..]).is_err());
    }

    // ------------------------------------------------------------ ranges

    #[test]
    fn parses_a_closed_range() {
        let r = parse_range("bytes=0-499", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 0, end: 499 });
        assert_eq!(r.len(), 500);
    }

    #[test]
    fn an_open_ended_range_runs_to_the_last_byte() {
        let r = parse_range("bytes=500-", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 500, end: 999 });
    }

    #[test]
    fn a_suffix_range_takes_the_final_bytes() {
        // Safari uses this form when seeking near the end of a media file.
        let r = parse_range("bytes=-100", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 900, end: 999 });
    }

    #[test]
    fn a_suffix_longer_than_the_file_starts_at_zero() {
        let r = parse_range("bytes=-5000", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 0, end: 999 });
    }

    #[test]
    fn an_end_past_the_file_is_clamped() {
        let r = parse_range("bytes=900-99999", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 900, end: 999 });
    }

    #[test]
    fn a_start_past_the_end_is_unsatisfiable() {
        assert!(parse_range("bytes=2000-", 1000).is_none());
    }

    #[test]
    fn a_reversed_range_is_rejected() {
        assert!(parse_range("bytes=500-100", 1000).is_none());
    }

    #[test]
    fn garbage_range_headers_fall_back_to_the_whole_resource() {
        for h in ["", "bytes=", "items=0-10", "bytes=abc-def", "bytes=--"] {
            assert!(parse_range(h, 1000).is_none(), "for {h:?}");
        }
    }

    #[test]
    fn a_range_against_an_empty_resource_is_unsatisfiable() {
        assert!(parse_range("bytes=0-10", 0).is_none());
    }

    #[test]
    fn only_the_first_of_a_multi_range_request_is_used() {
        let r = parse_range("bytes=0-99,200-299", 1000).unwrap();
        assert_eq!(r, ByteRange { start: 0, end: 99 });
    }

    // --------------------------------------------------------- responses

    #[test]
    fn a_response_declares_its_length() {
        let bytes = Response::ok("text/plain", b"hello".to_vec()).to_bytes(true);
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(s.contains("Content-Length: 5\r\n"));
        assert!(s.ends_with("\r\n\r\nhello"));
    }

    #[test]
    fn a_head_response_keeps_the_length_but_drops_the_body() {
        // Media elements issue HEAD first; a wrong length here breaks seeking.
        let r = Response::ok("audio/wav", vec![0u8; 500]);
        let bytes = r.to_bytes(false);
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("Content-Length: 500\r\n"));
        assert!(s.ends_with("\r\n\r\n"));
    }

    #[test]
    fn error_bodies_are_json_with_the_message_escaped() {
        let r = Response::error(404, "no such \"file\"");
        let s = String::from_utf8_lossy(&r.body).into_owned();
        assert_eq!(s, r#"{"error":"no such \"file\""}"#);
        assert_eq!(r.status, 404);
    }
}
