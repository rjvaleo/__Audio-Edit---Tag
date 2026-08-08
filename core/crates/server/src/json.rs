//! Just enough JSON to talk to the browser.
//!
//! Writing: a small builder, because every response shape here is known at
//! compile time. Reading: a permissive parser used only for the tag-edit
//! payload the UI posts back.

use std::collections::BTreeMap;
use std::fmt::Write as _;

/// Escape a string for inclusion in a JSON string literal.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Control characters must be escaped or the JSON is invalid.
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out
}

/// A JSON value, used for both building responses and parsing requests.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Value>),
    Obj(BTreeMap<String, Value>),
}

impl Value {
    pub fn obj() -> Self {
        Value::Obj(BTreeMap::new())
    }

    pub fn set(mut self, k: &str, v: impl Into<Value>) -> Self {
        if let Value::Obj(m) = &mut self {
            m.insert(k.to_string(), v.into());
        }
        self
    }

    pub fn get(&self, k: &str) -> Option<&Value> {
        match self {
            Value::Obj(m) => m.get(k),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_obj(&self) -> Option<&BTreeMap<String, Value>> {
        match self {
            Value::Obj(m) => Some(m),
            _ => None,
        }
    }

    pub fn to_string(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Num(n) => {
                // JSON has no NaN or Infinity; emit null so the browser gets
                // valid JSON rather than a parse error mid-stream.
                if n.is_finite() {
                    if *n == n.trunc() && n.abs() < 1e15 {
                        let _ = write!(out, "{}", *n as i64);
                    } else {
                        let _ = write!(out, "{n}");
                    }
                } else {
                    out.push_str("null");
                }
            }
            Value::Str(s) => {
                out.push('"');
                out.push_str(&escape(s));
                out.push('"');
            }
            Value::Arr(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write(out);
                }
                out.push(']');
            }
            Value::Obj(m) => {
                out.push('{');
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push('"');
                    out.push_str(&escape(k));
                    out.push_str("\":");
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Value::Str(v.to_string())
    }
}
impl From<String> for Value {
    fn from(v: String) -> Self {
        Value::Str(v)
    }
}
impl From<f64> for Value {
    fn from(v: f64) -> Self {
        Value::Num(v)
    }
}
impl From<f32> for Value {
    fn from(v: f32) -> Self {
        Value::Num(v as f64)
    }
}
impl From<u64> for Value {
    fn from(v: u64) -> Self {
        Value::Num(v as f64)
    }
}
impl From<usize> for Value {
    fn from(v: usize) -> Self {
        Value::Num(v as f64)
    }
}
impl From<u32> for Value {
    fn from(v: u32) -> Self {
        Value::Num(v as f64)
    }
}
impl From<u16> for Value {
    fn from(v: u16) -> Self {
        Value::Num(v as f64)
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Value::Bool(v)
    }
}
impl<T: Into<Value>> From<Vec<T>> for Value {
    fn from(v: Vec<T>) -> Self {
        Value::Arr(v.into_iter().map(Into::into).collect())
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Self {
        match v {
            Some(x) => x.into(),
            None => Value::Null,
        }
    }
}

/// Parse JSON. Returns `None` on anything malformed.
pub fn parse(s: &str) -> Option<Value> {
    let b = s.as_bytes();
    let mut i = 0;
    let v = parse_value(b, &mut i)?;
    skip_ws(b, &mut i);
    (i >= b.len()).then_some(v)
}

fn skip_ws(b: &[u8], i: &mut usize) {
    while *i < b.len() && (b[*i] as char).is_ascii_whitespace() {
        *i += 1;
    }
}

fn parse_value(b: &[u8], i: &mut usize) -> Option<Value> {
    skip_ws(b, i);
    match *b.get(*i)? {
        b'{' => parse_obj(b, i),
        b'[' => parse_arr(b, i),
        b'"' => parse_str(b, i).map(Value::Str),
        b't' => lit(b, i, "true", Value::Bool(true)),
        b'f' => lit(b, i, "false", Value::Bool(false)),
        b'n' => lit(b, i, "null", Value::Null),
        _ => parse_num(b, i),
    }
}

fn lit(b: &[u8], i: &mut usize, word: &str, v: Value) -> Option<Value> {
    if b[*i..].starts_with(word.as_bytes()) {
        *i += word.len();
        Some(v)
    } else {
        None
    }
}

fn parse_num(b: &[u8], i: &mut usize) -> Option<Value> {
    let start = *i;
    while *i < b.len() && matches!(b[*i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
        *i += 1;
    }
    std::str::from_utf8(&b[start..*i])
        .ok()?
        .parse::<f64>()
        .ok()
        .map(Value::Num)
}

fn parse_str(b: &[u8], i: &mut usize) -> Option<String> {
    if b.get(*i) != Some(&b'"') {
        return None;
    }
    *i += 1;
    let mut out = String::new();
    while *i < b.len() {
        match b[*i] {
            b'"' => {
                *i += 1;
                return Some(out);
            }
            b'\\' => {
                *i += 1;
                let c = *b.get(*i)?;
                *i += 1;
                match c {
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'b' => out.push('\u{8}'),
                    b'f' => out.push('\u{c}'),
                    b'u' => {
                        let hex = std::str::from_utf8(b.get(*i..*i + 4)?).ok()?;
                        let cp = u32::from_str_radix(hex, 16).ok()?;
                        *i += 4;
                        // Surrogate pairs: the UI sends these for emoji in notes.
                        let ch = if (0xD800..0xDC00).contains(&cp) {
                            if b.get(*i) == Some(&b'\\') && b.get(*i + 1) == Some(&b'u') {
                                let hex2 = std::str::from_utf8(b.get(*i + 2..*i + 6)?).ok()?;
                                let low = u32::from_str_radix(hex2, 16).ok()?;
                                *i += 6;
                                char::from_u32(0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00))?
                            } else {
                                char::REPLACEMENT_CHARACTER
                            }
                        } else {
                            char::from_u32(cp).unwrap_or(char::REPLACEMENT_CHARACTER)
                        };
                        out.push(ch);
                    }
                    other => out.push(other as char),
                }
            }
            _ => {
                // Take the whole UTF-8 sequence, not one byte.
                let rest = std::str::from_utf8(&b[*i..]).ok()?;
                let ch = rest.chars().next()?;
                out.push(ch);
                *i += ch.len_utf8();
            }
        }
    }
    None
}

fn parse_arr(b: &[u8], i: &mut usize) -> Option<Value> {
    *i += 1; // [
    let mut out = Vec::new();
    loop {
        skip_ws(b, i);
        if b.get(*i) == Some(&b']') {
            *i += 1;
            return Some(Value::Arr(out));
        }
        out.push(parse_value(b, i)?);
        skip_ws(b, i);
        match b.get(*i) {
            Some(b',') => *i += 1,
            Some(b']') => {}
            _ => return None,
        }
    }
}

fn parse_obj(b: &[u8], i: &mut usize) -> Option<Value> {
    *i += 1; // {
    let mut out = BTreeMap::new();
    loop {
        skip_ws(b, i);
        if b.get(*i) == Some(&b'}') {
            *i += 1;
            return Some(Value::Obj(out));
        }
        let k = parse_str(b, i)?;
        skip_ws(b, i);
        if b.get(*i) != Some(&b':') {
            return None;
        }
        *i += 1;
        out.insert(k, parse_value(b, i)?);
        skip_ws(b, i);
        match b.get(*i) {
            Some(b',') => *i += 1,
            Some(b'}') => {}
            _ => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_quotes_backslashes_and_newlines() {
        assert_eq!(escape(r#"a"b\c"#), r#"a\"b\\c"#);
        assert_eq!(escape("line\nbreak"), "line\\nbreak");
    }

    #[test]
    fn escapes_control_characters_as_unicode() {
        assert_eq!(escape("\u{1}"), "\\u0001");
    }

    #[test]
    fn leaves_non_ascii_alone() {
        // The archive has accented filenames; escaping them would be valid but
        // needlessly unreadable in the index.
        assert_eq!(escape("café"), "café");
    }

    #[test]
    fn builds_a_nested_object() {
        let v = Value::obj()
            .set("name", "kick 1.wav")
            .set("dur", 0.2f64)
            .set("ok", true);
        assert_eq!(v.to_string(), r#"{"dur":0.2,"name":"kick 1.wav","ok":true}"#);
    }

    #[test]
    fn whole_numbers_are_not_written_with_a_decimal_point() {
        assert_eq!(Value::from(44100u32).to_string(), "44100");
    }

    #[test]
    fn infinity_becomes_null_rather_than_invalid_json() {
        // Peak dBFS of a silent file is -inf, and it reaches the browser.
        assert_eq!(Value::Num(f64::NEG_INFINITY).to_string(), "null");
        assert_eq!(Value::Num(f64::NAN).to_string(), "null");
    }

    #[test]
    fn round_trips_an_object() {
        let src = r#"{"folders":{"kits":{"level1":"Drum","notes":"a \"quoted\" note"}}}"#;
        let v = parse(src).expect("parse");
        let note = v
            .get("folders")
            .and_then(|f| f.get("kits"))
            .and_then(|k| k.get("notes"))
            .and_then(|n| n.as_str());
        assert_eq!(note, Some(r#"a "quoted" note"#));
    }

    #[test]
    fn parses_arrays_numbers_and_literals() {
        let v = parse(r#"{"a":[1,2.5,-3e2],"b":null,"c":false}"#).expect("parse");
        assert_eq!(v.get("b"), Some(&Value::Null));
        assert_eq!(v.get("c"), Some(&Value::Bool(false)));
        match v.get("a") {
            Some(Value::Arr(a)) => {
                assert_eq!(a.len(), 3);
                assert_eq!(a[2], Value::Num(-300.0));
            }
            _ => panic!("expected array"),
        }
    }

    #[test]
    fn parses_unicode_escapes_including_surrogate_pairs() {
        let v = parse(r#"{"s":"café 🎵"}"#).expect("parse");
        assert_eq!(v.get("s").and_then(|s| s.as_str()), Some("café 🎵"));
    }

    #[test]
    fn parses_raw_utf8_in_strings() {
        let v = parse("{\"s\":\"café\"}").expect("parse");
        assert_eq!(v.get("s").and_then(|s| s.as_str()), Some("café"));
    }

    #[test]
    fn rejects_malformed_input() {
        for bad in [
            "{",
            "{\"a\"}",
            "{\"a\":}",
            "[1,2",
            "{\"a\":1} trailing",
            "",
        ] {
            assert!(parse(bad).is_none(), "should reject {bad:?}");
        }
    }

    #[test]
    fn tolerates_whitespace_everywhere() {
        assert!(parse("  {  \"a\" : [ 1 , 2 ]  }  ").is_some());
    }
}
