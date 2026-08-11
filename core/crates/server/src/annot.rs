//! Operations on markers and regions.
//!
//! Peak's Action menu is mostly this: turn these markers into regions, split
//! that region here, nudge everything in the selection along, rename a run of
//! them. None of it touches audio, so none of it is in the `edit` crate — a
//! marker is a note about a place, and moving one changes nothing you can hear.
//!
//! Everything here is a pure function of the annotations and the selection,
//! which is what makes the naming rules — the part with real behaviour hiding
//! in it — testable without a file or a request.

use crate::docs::{Annotations, Marker, Region};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn marks(frames: &[(u64, &str)]) -> Annotations {
        Annotations {
            markers: frames
                .iter()
                .map(|(f, l)| Marker { frame: *f, label: (*l).into() })
                .collect(),
            regions: Vec::new(),
        }
    }

    // ------------------------------------------------------ markers → regions

    #[test]
    fn three_markers_become_two_regions_named_after_the_first_two() {
        // Peak's own worked example, straight from the manual.
        let mut a = marks(&[(100, "Foo 1"), (200, "Foo 2"), (300, "Foo 3")]);
        a.markers_to_regions(Span::new(0, 0), false);
        assert_eq!(a.regions.len(), 2);
        assert_eq!(a.regions[0], Region { start: 100, end: 200, label: "Foo 1".into() });
        assert_eq!(a.regions[1], Region { start: 200, end: 300, label: "Foo 2".into() });
    }

    #[test]
    fn two_markers_become_one_region() {
        let mut a = marks(&[(100, "a"), (200, "b")]);
        a.markers_to_regions(Span::new(0, 0), false);
        assert_eq!(a.regions.len(), 1);
        assert_eq!(a.regions[0].label, "a");
    }

    #[test]
    fn the_regions_made_are_butt_spliced_with_no_gap_between_them() {
        let mut a = marks(&[(100, "a"), (250, "b"), (300, "c"), (900, "d")]);
        a.markers_to_regions(Span::new(0, 0), false);
        for pair in a.regions.windows(2) {
            assert_eq!(pair[0].end, pair[1].start, "a gap opened up: {pair:?}");
        }
    }

    #[test]
    fn one_marker_cannot_make_a_region() {
        let mut a = marks(&[(100, "a")]);
        a.markers_to_regions(Span::new(0, 0), false);
        assert!(a.regions.is_empty());
    }

    #[test]
    fn only_the_markers_in_the_selection_are_converted() {
        let mut a = marks(&[(100, "a"), (200, "b"), (300, "c"), (400, "d")]);
        a.markers_to_regions(Span::new(150, 350), false);
        assert_eq!(a.regions.len(), 1);
        assert_eq!(a.regions[0], Region { start: 200, end: 300, label: "b".into() });
    }

    #[test]
    fn the_option_variant_ends_the_last_region_on_a_marker_outside_the_selection() {
        // Peak: "hold Option to make each marker a Region that ends at the
        // next marker" — which is one more region than the plain command.
        let mut a = marks(&[(100, "a"), (200, "b"), (300, "c")]);
        a.markers_to_regions(Span::new(50, 250), true);
        assert_eq!(a.regions.len(), 2, "{:?}", a.regions);
        assert_eq!(a.regions[1], Region { start: 200, end: 300, label: "b".into() });
    }

    // -------------------------------------------------------- splitting a region

    #[test]
    fn splitting_a_region_gives_two_that_meet_where_the_cursor_was() {
        let mut a = Annotations {
            markers: vec![],
            regions: vec![Region { start: 100, end: 500, label: "Verse".into() }],
        };
        a.split_region(300, 1000);
        assert_eq!(a.regions.len(), 2);
        assert_eq!(a.regions[0], Region { start: 100, end: 300, label: "Verse".into() });
        assert_eq!(a.regions[1], Region { start: 300, end: 500, label: "Verse 2".into() });
    }

    #[test]
    fn splitting_a_split_keeps_counting_rather_than_making_two_seconds() {
        let mut a = Annotations {
            markers: vec![],
            regions: vec![Region { start: 0, end: 900, label: "Take".into() }],
        };
        a.split_region(300, 900);
        a.split_region(600, 900);
        let names: Vec<&str> = a.regions.iter().map(|r| r.label.as_str()).collect();
        assert_eq!(names, vec!["Take", "Take 2", "Take 3"], "{names:?}");
    }

    #[test]
    fn a_split_never_lands_on_a_name_something_else_already_has() {
        // Splitting "Foo 1" beside an existing "Foo 2" used to make a second
        // "Foo 2", and two regions with one name is not a name.
        let mut a = Annotations {
            markers: vec![],
            regions: vec![
                Region { start: 0, end: 400, label: "Foo 1".into() },
                Region { start: 400, end: 800, label: "Foo 2".into() },
            ],
        };
        a.split_region(200, 800);
        let mut names: Vec<&str> = a.regions.iter().map(|r| r.label.as_str()).collect();
        let before = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), before, "a name was reused: {names:?}");
    }

    #[test]
    fn splitting_a_document_with_no_regions_creates_the_two_halves() {
        let mut a = Annotations::default();
        a.split_region(400, 1000);
        assert_eq!(a.regions.len(), 2);
        assert_eq!(a.regions[0].end, 400);
        assert_eq!(a.regions[1].start, 400);
        assert_eq!(a.regions[1].end, 1000);
    }

    #[test]
    fn splitting_at_an_edge_does_nothing_rather_than_making_an_empty_region() {
        let mut a = Annotations::default();
        a.split_region(0, 1000);
        a.split_region(1000, 1000);
        assert!(a.regions.is_empty());
    }

    // ------------------------------------------------------------------ nudge

    #[test]
    fn nudging_moves_everything_in_the_selection_and_nothing_outside_it() {
        let mut a = marks(&[(100, "a"), (500, "b")]);
        a.regions.push(Region { start: 120, end: 220, label: "r".into() });
        a.nudge(Span::new(0, 300), 50);
        assert_eq!(a.markers[0].frame, 150);
        assert_eq!(a.markers[1].frame, 500, "outside the selection");
        assert_eq!(a.regions[0], Region { start: 170, end: 270, label: "r".into() });
    }

    #[test]
    fn nudging_backwards_works_and_stops_at_the_start_of_the_file() {
        let mut a = marks(&[(30, "a"), (500, "b")]);
        a.nudge(Span::new(0, 0), -100);
        assert_eq!(a.markers[0].frame, 0, "must not wrap around");
        assert_eq!(a.markers[1].frame, 400);
    }

    #[test]
    fn nudging_a_region_keeps_its_length() {
        let mut a = Annotations {
            markers: vec![],
            regions: vec![Region { start: 100, end: 400, label: "r".into() }],
        };
        a.nudge(Span::new(0, 0), -1000);
        assert_eq!(a.regions[0].start, 0);
        assert_eq!(a.regions[0].end, 300, "the length changed");
    }

    #[test]
    fn nudging_leaves_everything_in_timeline_order() {
        let mut a = marks(&[(100, "a"), (200, "b"), (300, "c")]);
        a.nudge(Span::new(150, 250), 400); // b jumps past c
        assert_eq!(
            a.markers.iter().map(|m| m.frame).collect::<Vec<_>>(),
            vec![100, 300, 600]
        );
    }

    // ----------------------------------------------------------------- delete

    #[test]
    fn deleting_markers_in_a_selection_leaves_the_rest() {
        let mut a = marks(&[(100, "a"), (200, "b"), (900, "c")]);
        a.delete_in(Span::new(50, 250));
        assert_eq!(a.markers.len(), 1);
        assert_eq!(a.markers[0].label, "c");
    }

    // ----------------------------------------------------------------- rename

    #[test]
    fn a_pattern_with_no_hash_renames_everything_the_same() {
        let mut a = marks(&[(1, "x"), (2, "y")]);
        a.rename(Span::new(0, 0), "PeakPro", "1", None, true, true);
        assert_eq!(a.markers[0].label, "PeakPro");
        assert_eq!(a.markers[1].label, "PeakPro");
    }

    #[test]
    fn a_hash_counts_up_from_the_start_value() {
        // Peak's example: "PeakPro#" starting at 1.
        let mut a = marks(&[(1, "x"), (2, "y"), (3, "z")]);
        a.rename(Span::new(0, 0), "PeakPro#", "1", None, true, true);
        let names: Vec<&str> = a.markers.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(names, vec!["PeakPro1", "PeakPro2", "PeakPro3"]);
    }

    #[test]
    fn zeros_after_the_hash_set_the_width() {
        // Peak's example: "Event #000" starting at 10 gives "Event 010".
        assert_eq!(expand("Event #000", "10", 0), "Event 010");
        assert_eq!(expand("Event #000", "10", 1), "Event 011");
        assert_eq!(expand("Event #000", "10", 2), "Event 012");
    }

    #[test]
    fn text_after_the_counter_is_kept() {
        assert_eq!(expand("take # of many", "1", 0), "take 1 of many");
        assert_eq!(expand("take #00 of many", "1", 0), "take 01 of many");
    }

    #[test]
    fn a_letter_start_counts_through_the_alphabet_without_repeating() {
        assert_eq!(expand("clip #", "A", 0), "clip A");
        assert_eq!(expand("clip #", "A", 1), "clip B");
        assert_eq!(expand("clip #", "A", 25), "clip Z");
        // Past Z it must keep going rather than wrapping back onto "A".
        assert_eq!(expand("clip #", "A", 26), "clip AA");
        assert_eq!(expand("clip #", "A", 27), "clip AB");
        assert_ne!(expand("clip #", "A", 26), expand("clip #", "A", 0));
    }

    #[test]
    fn a_lower_case_start_stays_lower_case() {
        assert_eq!(expand("clip #", "c", 0), "clip c");
        assert_eq!(expand("clip #", "c", 1), "clip d");
    }

    #[test]
    fn a_start_that_is_neither_a_number_nor_a_letter_still_counts() {
        assert_eq!(expand("x#", "", 0), "x1");
        assert_eq!(expand("x#", "", 1), "x2");
    }

    #[test]
    fn renaming_only_touches_names_containing_the_text_when_one_is_given() {
        let mut a = marks(&[(1, "hit one"), (2, "pad"), (3, "hit two")]);
        a.rename(Span::new(0, 0), "Hit #", "1", Some("hit"), true, false);
        let names: Vec<&str> = a.markers.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(names, vec!["Hit 1", "pad", "Hit 2"]);
    }

    #[test]
    fn renaming_numbers_in_timeline_order_not_creation_order() {
        // Peak says so explicitly: markers repositioned after creation are
        // renamed by where they now are.
        let mut a = Annotations {
            markers: vec![
                Marker { frame: 900, label: "made first".into() },
                Marker { frame: 100, label: "made second".into() },
            ],
            regions: vec![],
        };
        a.rename(Span::new(0, 0), "m#", "1", None, true, false);
        assert_eq!(a.markers[0].frame, 100);
        assert_eq!(a.markers[0].label, "m1");
        assert_eq!(a.markers[1].label, "m2");
    }

    #[test]
    fn regions_can_be_renamed_without_touching_markers() {
        let mut a = marks(&[(1, "keep me")]);
        a.regions.push(Region { start: 0, end: 10, label: "old".into() });
        a.rename(Span::new(0, 0), "R#", "1", None, false, true);
        assert_eq!(a.markers[0].label, "keep me");
        assert_eq!(a.regions[0].label, "R1");
    }

    #[test]
    fn an_empty_selection_means_the_whole_document() {
        let mut a = marks(&[(0, "a"), (99999, "b")]);
        a.rename(Span::new(0, 0), "all #", "1", None, true, false);
        assert_eq!(a.markers[1].label, "all 2");
    }
}
