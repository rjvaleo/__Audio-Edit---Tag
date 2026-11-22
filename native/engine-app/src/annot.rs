//! Markers and regions: MGL's own (`core/crates/server-core/src/annot.rs`
//! and the `Annotations` of `docs.rs`), ported as they are, with JSON through
//! serde_json in place of the server's own. The operations below are MGL's,
//! line for line: Peak's Action menu over markers and regions.
//!
//! Operations on markers and regions.
//!
//! Peak's Action menu is mostly this: turn these markers into regions, split
//! that region here, nudge everything in the selection along, rename a run of
//! them. None of it touches audio, so none of it is in the `edit` crate — a
//! marker is a note about a place, and moving one changes nothing you can hear.

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Marker {
    pub frame: u64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Region {
    pub start: u64,
    pub end: u64,
    pub label: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Annotations {
    pub markers: Vec<Marker>,
    pub regions: Vec<Region>,
}

impl Annotations {
    pub fn to_json(&self) -> Value {
        json!({
            "markers": self.markers.iter().map(|m| json!({ "frame": m.frame, "label": m.label })).collect::<Vec<_>>(),
            "regions": self.regions.iter().map(|r| json!({ "start": r.start, "end": r.end, "label": r.label })).collect::<Vec<_>>(),
        })
    }

    /// As MGL's `from_json`: regions normalised, both in timeline order.
    pub fn from_json(v: &Value) -> Self {
        let num = |x: Option<&Value>| match x.and_then(Value::as_f64) {
            Some(n) if n >= 0.0 => n as u64,
            _ => 0,
        };
        let text = |x: Option<&Value>| x.and_then(Value::as_str).unwrap_or("").to_string();
        let mut out = Annotations::default();
        if let Some(ms) = v.get("markers").and_then(Value::as_array) {
            for m in ms {
                out.markers.push(Marker { frame: num(m.get("frame")), label: text(m.get("label")) });
            }
        }
        if let Some(rs) = v.get("regions").and_then(Value::as_array) {
            for r in rs {
                let (start, end) = (num(r.get("start")), num(r.get("end")));
                out.regions.push(Region { start: start.min(end), end: start.max(end), label: text(r.get("label")) });
            }
        }
        out.markers.sort_by_key(|m| m.frame);
        out.regions.sort_by_key(|r| r.start);
        out
    }
}

/// A half-open frame range, matching the one the edit engine selects with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u64,
    pub end: u64,
}

impl Span {
    pub fn new(start: u64, end: u64) -> Self {
        if start <= end {
            Span { start, end }
        } else {
            Span { start: end, end: start }
        }
    }

    /// A span with nothing in it means *everything*, the way Select All does.
    pub fn is_everything(&self) -> bool {
        self.end <= self.start
    }

    pub fn holds(&self, frame: u64) -> bool {
        self.is_everything() || (frame >= self.start && frame <= self.end)
    }
}

impl Annotations {
    /// Turn the markers in `span` into regions running between them.
    ///
    /// Peak: three markers named "Foo 1", "Foo 2", "Foo 3" become **two**
    /// regions, "Foo 1" and "Foo 2" — each marker is the start of one region
    /// and the end of the one before, so the last marker names nothing. Holding
    /// Option instead gives every marker a region ending at the next, which is
    /// `each`, and needs one more marker after the selection to end on.
    pub fn markers_to_regions(&mut self, span: Span, each: bool) {
        let inside: Vec<Marker> = self
            .markers
            .iter()
            .filter(|m| span.holds(m.frame))
            .cloned()
            .collect();
        if inside.len() < 2 {
            return;
        }
        let last = if each {
            // Every selected marker gets a region; the one that ends the final
            // region may be outside the selection, which is the whole point of
            // the variant.
            inside.len()
        } else {
            inside.len() - 1
        };
        for i in 0..last {
            let start = inside[i].frame;
            let end = match inside.get(i + 1) {
                Some(next) => next.frame,
                None => match self.markers.iter().find(|m| m.frame > start) {
                    Some(next) => next.frame,
                    None => continue, // nothing to end on: no region
                },
            };
            if end <= start {
                continue;
            }
            self.regions.push(Region {
                start,
                end,
                label: inside[i].label.clone(),
            });
        }
        self.regions.sort_by_key(|r| r.start);
    }

    /// Split whatever region holds `pos` in two, or the document if none does.
    ///
    /// Peak's New Region Split. With no region under the cursor it splits "an
    /// existing Region **or audio document**", so a document with no regions
    /// at all comes out with two — which is the useful behaviour and the one
    /// its own description promises.
    pub fn split_region(&mut self, pos: u64, total: u64) {
        if let Some(i) = self
            .regions
            .iter()
            .position(|r| pos > r.start && pos < r.end)
        {
            let r = self.regions[i].clone();
            let taken: Vec<&str> = self.regions.iter().map(|x| x.label.as_str()).collect();
            let fresh = split_name(&r.label, &taken);
            self.regions[i] = Region { start: r.start, end: pos, label: r.label.clone() };
            self.regions.insert(i + 1, Region { start: pos, end: r.end, label: fresh });
            return;
        }
        if pos > 0 && pos < total {
            self.regions.push(Region { start: 0, end: pos, label: "Region 1".into() });
            self.regions.push(Region { start: pos, end: total, label: "Region 2".into() });
            self.regions.sort_by_key(|r| r.start);
        }
    }

    /// Move every marker and region in `span` by `delta` frames.
    ///
    /// Peak's Nudge, which takes a positive or negative number. Nothing is
    /// allowed before frame zero: a marker at a negative position would come
    /// back through `as u64` as eighteen quintillion and break the ruler.
    pub fn nudge(&mut self, span: Span, delta: i64) {
        let shift = |f: u64| -> u64 {
            if delta >= 0 {
                f.saturating_add(delta as u64)
            } else {
                f.saturating_sub(delta.unsigned_abs())
            }
        };
        for m in &mut self.markers {
            if span.holds(m.frame) {
                m.frame = shift(m.frame);
            }
        }
        for r in &mut self.regions {
            if span.holds(r.start) {
                let len = r.end - r.start;
                r.start = shift(r.start);
                r.end = r.start + len;
            }
        }
        self.markers.sort_by_key(|m| m.frame);
        self.regions.sort_by_key(|r| r.start);
    }

    /// Remove every marker and region in `span`.
    ///
    /// Peak's Delete Markers Only: the audio stays, the notes about it go.
    pub fn delete_in(&mut self, span: Span) {
        self.markers.retain(|m| !span.holds(m.frame));
        self.regions.retain(|r| !span.holds(r.start));
    }

    /// Rename a run of markers and regions.
    ///
    /// Peak's Rename dialog. `pattern` may contain `#`, which becomes a number
    /// or letter counting up from `start`, and zeros after the `#` set the
    /// width. `contains`, when given, restricts it to names holding that text.
    ///
    /// Renaming happens **in timeline order**, not the order things were
    /// created, which is what Peak's own note about repositioned markers says.
    pub fn rename(
        &mut self,
        span: Span,
        pattern: &str,
        start: &str,
        contains: Option<&str>,
        do_markers: bool,
        do_regions: bool,
    ) {
        self.markers.sort_by_key(|m| m.frame);
        self.regions.sort_by_key(|r| r.start);

        let wanted = |label: &str| -> bool {
            contains.map_or(true, |t| t.is_empty() || label.contains(t))
        };

        let mut n = 0usize;
        if do_markers {
            for m in &mut self.markers {
                if span.holds(m.frame) && wanted(&m.label) {
                    m.label = expand(pattern, start, n);
                    n += 1;
                }
            }
        }
        if do_regions {
            for r in &mut self.regions {
                if span.holds(r.start) && wanted(&r.label) {
                    r.label = expand(pattern, start, n);
                    n += 1;
                }
            }
        }
    }
}

/// The name the second half of a split region gets.
///
/// "Foo" splits into "Foo" and "Foo 2"; splitting again gives "Foo 3". It keeps
/// counting until it finds a name nothing else is using — splitting "Foo 1"
/// next to an existing "Foo 2" otherwise produces a second "Foo 2", and two
/// regions with one name is not a name.
fn split_name(label: &str, taken: &[&str]) -> String {
    let (head, mut n) = match label.rsplit_once(' ') {
        Some((h, tail)) => match tail.parse::<u32>() {
            Ok(n) => (h.to_string(), n),
            Err(_) => (label.to_string(), 1),
        },
        None => (label.to_string(), 1),
    };
    loop {
        n += 1;
        let candidate = format!("{head} {n}");
        if !taken.iter().any(|t| *t == candidate) {
            return candidate;
        }
    }
}

/// Expand a rename pattern for the `index`-th thing being renamed.
///
/// `#` is replaced by a counter starting at `start`; zeros immediately after
/// the `#` are consumed and set the minimum width. A `start` that is not a
/// number counts through letters instead — A, B, … Z, AA, AB — which never
/// repeats a name however long the run is.
pub fn expand(pattern: &str, start: &str, index: usize) -> String {
    let Some(at) = pattern.find('#') else {
        return pattern.to_string();
    };
    let rest = &pattern[at + 1..];
    let zeros = rest.chars().take_while(|c| *c == '0').count();
    let tail = &rest[zeros..];
    let head = &pattern[..at];

    let counter = match start.trim().parse::<u64>() {
        Ok(n) => {
            let value = n + index as u64;
            if zeros > 0 {
                format!("{value:0zeros$}")
            } else {
                value.to_string()
            }
        }
        Err(_) => letters(start.trim(), index),
    };
    format!("{head}{counter}{tail}")
}

/// Count up through letters from `start`, spreadsheet fashion.
fn letters(start: &str, index: usize) -> String {
    let first = start.chars().next().filter(|c| c.is_ascii_alphabetic());
    let Some(first) = first else {
        // Neither a number nor a letter: fall back to counting from one, which
        // is at least a sequence, rather than repeating one name.
        return (index + 1).to_string();
    };
    let upper = first.is_ascii_uppercase();
    let base = if upper { b'A' } else { b'a' };
    let mut n = (first as u8 - base) as usize + index;
    let mut out = Vec::new();
    loop {
        out.push((base + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    out.reverse();
    out.into_iter().collect()
}
