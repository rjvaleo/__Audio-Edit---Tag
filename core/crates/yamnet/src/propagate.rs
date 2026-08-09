//! Lending a name to the sounds that did not get one.
//!
//! The model is good at a snare that rings for a third of a second and lost on
//! one that lasts a tenth. But a library is not a bag of unrelated files:
//! `snare 2.wav` sits next to `snare 1.wav`, was made on the same day by the
//! same person, and sounds like it. When one of them is recognised and the
//! other is not, the answer is already in the room.
//!
//! Two kinds of neighbour are used, in that order:
//!
//! 1. **The filename family.** `snare 1`, `snare 2` … `snare 5` are one family;
//!    so are `fla pt 1` through `fla pt 12`. This is the only place a filename
//!    is allowed to influence a label, and even here it decides *who* to ask,
//!    never *what the answer is* — the answer always comes from audio the model
//!    was sure about.
//! 2. **Sonic neighbours**, when the family has nothing to offer.
//!
//! A borrowed label records where it came from, so the interface can say
//! "like snare 1.wav" rather than pretending to have heard it directly. Nothing
//! borrowed is ever lent on: a label travels one hop from the file it was
//! actually measured on, so a single confident sound cannot quietly rename half
//! the library.

use crate::{is_generic, Detection};
use std::collections::BTreeMap;

/// How sure the model has to be before a label is worth passing around.
///
/// Below this it is a guess, and a guess spread across a family becomes five
/// wrong labels instead of one.
pub const CONFIDENT: f32 = 0.15;

/// What is known about a sound, and whether we heard it or were told.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Labels {
    pub words: Vec<Detection>,
    /// The file this was taken from, if it was not measured here.
    pub from: Option<String>,
}

impl Labels {
    /// Measured here, specific, and sure enough to lend to a neighbour.
    pub fn strong(&self) -> bool {
        self.from.is_none()
            && self
                .words
                .iter()
                .any(|d| d.score >= CONFIDENT && !is_generic(&d.label))
    }

    /// Something specific was heard here, however faintly.
    ///
    /// Weaker than [`Labels::strong`]: a 0.06 on "Piano" is not worth lending
    /// to anyone, but it is still the model's own answer about this file and
    /// should not be thrown away for a stranger's.
    pub fn named(&self) -> bool {
        self.from.is_none() && self.words.iter().any(|d| !is_generic(&d.label))
    }

    fn best(&self) -> f32 {
        self.words.first().map(|d| d.score).unwrap_or(0.0)
    }
}

/// The group a file belongs to, by name.
///
/// One trailing number is dropped, which is what turns `snare 1` … `snare 5`
/// into `snare` while leaving `kick 909` distinct from `kick`. The folder is
/// kept so families cannot reach across two unrelated sample packs that both
/// happen to contain a `hit 1`.
pub fn family(path: &str) -> String {
    let dir = path.rfind('/').map(|i| &path[..i]).unwrap_or("");
    format!("{}/{}", dir.to_lowercase(), base_name(path))
}

/// A filename reduced to the part that names the sound.
///
/// The extension goes, trailing punctuation goes, and one trailing number goes
/// — because that last number is a take, not a name. Only one, though:
/// `vox warble 32000` is a sample rate and `kick 909` is a drum machine, and
/// stripping every digit would throw both away along with the take index.
///
/// Shared with the tag suggestions, so the words offered for `snare 1.wav` and
/// the family it is grouped into can never disagree about what it is called.
pub fn base_name(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
    let stem = stem.trim().to_lowercase();
    let stem = stem.trim_end_matches(|c: char| !c.is_alphanumeric());

    match stem.rsplit_once(' ') {
        Some((head, tail)) if !head.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) => {
            head.trim().to_string()
        }
        _ => stem.trim().to_string(),
    }
}

/// The words from a filename that are worth keeping as tags.
///
/// The take number is already gone by the time [`base_name`] hands the name
/// over, so everything left is a word somebody chose — including the digits.
/// `kick 909 1` gives `kick 909`: the 1 was the take, the 909 is the drum
/// machine. Dropping every number would lose the half that means something.
pub fn name_words(path: &str) -> Vec<String> {
    let base = base_name(path);
    let mut out: Vec<String> = Vec::new();
    for w in base.split(|c: char| c.is_whitespace() || c == '_') {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric());
        // A single character is a series marker — `b 1`, `b 2` — and names the
        // sequence rather than the sound.
        if w.len() < 2 {
            continue;
        }
        if !out.iter().any(|e| e == w) {
            out.push(w.to_string());
        }
    }
    out
}

/// Fill in the sounds the model could not name, from the ones it could.
///
/// `neighbours` returns other paths in order of sonic likeness, best first. It
/// is passed in rather than computed here so this stays a pure rearrangement of
/// labels, testable without a model, a library, or an audio file.
pub fn propagate<F>(known: &BTreeMap<String, Labels>, neighbours: F) -> BTreeMap<String, Labels>
where
    F: Fn(&str) -> Vec<String>,
{
    // Who is in which family, and which of them are worth asking.
    let mut families: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for path in known.keys() {
        families.entry(family(path)).or_default().push(path.as_str());
    }
    let empty: Vec<&str> = Vec::new();

    let mut out = known.clone();
    for (path, labels) in known {
        if labels.strong() {
            continue;
        }

        // The most confident sibling in the family. Ties go to the earlier
        // path so the result does not depend on iteration order.
        let donor = families
            .get(&family(path))
            .unwrap_or(&empty)
            .iter()
            .filter(|p| **p != path.as_str())
            .filter(|p| known.get(**p).is_some_and(|l| l.strong()))
            .max_by(|a, b| {
                let (x, y) = (known[**a].best(), known[**b].best());
                x.total_cmp(&y).then(b.cmp(a))
            })
            .map(|p| p.to_string())
            // Failing that, the nearest sound that was recognised — but only
            // for a file the model had nothing specific to say about.
            //
            // A sibling and a stranger are not equal evidence. `snare 2` next
            // to `snare 1` is the same drum recorded twice; two files that
            // merely measure alike are not, and letting one overwrite the
            // other turned a jazz piano loop into a Tabla and a spoken word
            // sample into a Didgeridoo. So a stranger is only asked when there
            // is nothing of our own to lose.
            .or_else(|| {
                if labels.named() {
                    return None;
                }
                neighbours(path)
                    .into_iter()
                    .find(|n| n != path && known.get(n).is_some_and(|l| l.strong()))
            });

        if let Some(d) = donor {
            // Read from `known`, never from `out`: a borrowed label must not
            // become the source of another loan.
            out.insert(
                path.clone(),
                Labels { words: known[&d].words.clone(), from: Some(d) },
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn det(label: &str, score: f32) -> Detection {
        Detection { label: label.to_string(), score }
    }

    fn heard(words: &[(&str, f32)]) -> Labels {
        Labels { words: words.iter().map(|(l, s)| det(l, *s)).collect(), from: None }
    }

    fn none() -> Vec<String> {
        Vec::new()
    }

    #[test]
    fn one_trailing_number_makes_a_family() {
        assert_eq!(family("Pack/snare 1.wav"), "pack/snare");
        assert_eq!(family("Pack/snare 12.wav"), "pack/snare");
        assert_eq!(family("Pack/fla pt 10.wav"), "pack/fla pt");
    }

    #[test]
    fn only_one_number_is_dropped() {
        // The 909 is part of the name; the 1 is the take.
        assert_eq!(family("Pack/kick 909 1.wav"), "pack/kick 909");
    }

    #[test]
    fn families_do_not_reach_across_folders() {
        assert_ne!(family("A/hit 1.wav"), family("B/hit 1.wav"));
    }

    #[test]
    fn trailing_punctuation_does_not_split_a_family() {
        assert_eq!(family("Pack/kick 909 1?.wav"), family("Pack/kick 909 2.wav"));
    }

    #[test]
    fn a_take_number_is_not_a_tag_but_a_name_containing_one_is() {
        assert_eq!(name_words("P/snare 1.wav"), ["snare"]);
        assert_eq!(name_words("P/kick 909 1?.wav"), ["kick", "909"]);
        // The 32000 here is the trailing number, so it goes the way any take
        // index would. Only one number is ever dropped, and it is the last.
        assert_eq!(name_words("P/vox warble 32000.wav"), ["vox", "warble"]);
        assert_eq!(name_words("P/hat 90 1.wav"), ["hat", "90"]);
    }

    #[test]
    fn a_serial_letter_is_not_a_tag() {
        // `b 1.wav`, `b 2.wav` — the b names a series, not a sound.
        assert!(name_words("P/b 1.wav").is_empty());
    }

    #[test]
    fn punctuation_does_not_become_part_of_a_tag() {
        assert_eq!(name_words("P/flanged?.wav"), ["flanged"]);
        assert_eq!(name_words("P/fla pt 10.wav"), ["fla", "pt"]);
    }

    #[test]
    fn tag_words_and_the_family_agree_about_the_name() {
        // Both go through base_name, so they cannot drift apart.
        assert_eq!(family("P/snare 1.wav"), "p/snare");
        assert_eq!(name_words("P/snare 1.wav").join(" "), "snare");
    }

    #[test]
    fn a_weak_sound_takes_its_familys_name() {
        let mut known = BTreeMap::new();
        known.insert("P/snare 1.wav".into(), heard(&[("Snare drum", 0.53)]));
        known.insert("P/snare 2.wav".into(), heard(&[("Burst, pop", 0.08)]));

        let out = propagate(&known, |_| none());
        let got = &out["P/snare 2.wav"];
        assert_eq!(got.words[0].label, "Snare drum");
        assert_eq!(got.from.as_deref(), Some("P/snare 1.wav"));
    }

    #[test]
    fn a_sound_the_model_was_sure_about_is_left_alone() {
        let mut known = BTreeMap::new();
        known.insert("P/snare 1.wav".into(), heard(&[("Snare drum", 0.53)]));
        known.insert("P/snare 2.wav".into(), heard(&[("Bass drum", 0.40)]));

        let out = propagate(&known, |_| none());
        assert_eq!(out["P/snare 2.wav"].words[0].label, "Bass drum");
        assert!(out["P/snare 2.wav"].from.is_none());
    }

    #[test]
    fn a_vague_label_does_not_count_as_knowing_what_it_is() {
        let mut known = BTreeMap::new();
        known.insert("P/a 1.wav".into(), heard(&[("Music", 0.99)]));
        known.insert("P/a 2.wav".into(), heard(&[("Music", 0.99)]));

        // Neither is specific, so there is nothing to lend and nothing changes.
        let out = propagate(&known, |_| none());
        assert!(out.values().all(|l| l.from.is_none()));
    }

    #[test]
    fn a_sonic_neighbour_is_asked_when_the_family_has_nobody() {
        let mut known = BTreeMap::new();
        known.insert("P/lonely.wav".into(), heard(&[]));
        known.insert("P/cymbal thing.wav".into(), heard(&[("Cymbal", 0.44)]));

        let out = propagate(&known, |p| {
            if p == "P/lonely.wav" { vec!["P/cymbal thing.wav".into()] } else { none() }
        });
        assert_eq!(out["P/lonely.wav"].words[0].label, "Cymbal");
        assert_eq!(out["P/lonely.wav"].from.as_deref(), Some("P/cymbal thing.wav"));
    }

    /// A stranger's confident name must not displace this file's own answer,
    /// however faint. This is the case that turned a piano loop into a Tabla.
    #[test]
    fn a_stranger_cannot_overwrite_a_name_we_heard_ourselves() {
        let mut known = BTreeMap::new();
        known.insert("P/jazz loop.wav".into(), heard(&[("Piano", 0.06)]));
        known.insert("P/hand drum.wav".into(), heard(&[("Tabla", 0.38)]));

        let out = propagate(&known, |_| vec!["P/hand drum.wav".into()]);
        assert_eq!(out["P/jazz loop.wav"].words[0].label, "Piano");
        assert!(out["P/jazz loop.wav"].from.is_none());
    }

    /// A family member still may, because two takes of the same drum are not
    /// strangers.
    #[test]
    fn a_sibling_can_overwrite_a_faint_wrong_answer() {
        let mut known = BTreeMap::new();
        known.insert("P/snare 1.wav".into(), heard(&[("Snare drum", 0.53)]));
        known.insert("P/snare 2.wav".into(), heard(&[("Burst, pop", 0.08)]));

        let out = propagate(&known, |_| none());
        assert_eq!(out["P/snare 2.wav"].words[0].label, "Snare drum");
    }

    #[test]
    fn a_file_with_only_a_vague_answer_may_still_ask_a_stranger() {
        let mut known = BTreeMap::new();
        known.insert("P/thing.wav".into(), heard(&[("Music", 0.90)]));
        known.insert("P/pad.wav".into(), heard(&[("New-age music", 0.30)]));

        let out = propagate(&known, |_| vec!["P/pad.wav".into()]);
        assert_eq!(out["P/thing.wav"].words[0].label, "New-age music");
    }

    #[test]
    fn speech_counts_as_knowing_what_a_sound_is() {
        // In a sample library "Speech" means vocal, which is worth keeping.
        let l = heard(&[("Speech", 0.96)]);
        assert!(l.strong(), "a confident Speech should not be treated as vague");
    }

    #[test]
    fn the_family_is_preferred_over_a_closer_sounding_stranger() {
        let mut known = BTreeMap::new();
        known.insert("P/snare 1.wav".into(), heard(&[("Snare drum", 0.53)]));
        known.insert("P/snare 2.wav".into(), heard(&[]));
        known.insert("P/other.wav".into(), heard(&[("Cymbal", 0.90)]));

        let out = propagate(&known, |_| vec!["P/other.wav".into()]);
        assert_eq!(out["P/snare 2.wav"].words[0].label, "Snare drum");
    }

    #[test]
    fn a_borrowed_label_is_never_lent_on() {
        let mut known = BTreeMap::new();
        known.insert("P/snare 1.wav".into(), heard(&[("Snare drum", 0.53)]));
        known.insert("P/snare 2.wav".into(), heard(&[]));
        // Unrelated name, so it can only reach snare 2 through the neighbour list.
        known.insert("P/mystery.wav".into(), heard(&[]));

        let out = propagate(&known, |p| {
            if p == "P/mystery.wav" { vec!["P/snare 2.wav".into()] } else { none() }
        });
        assert_eq!(out["P/snare 2.wav"].from.as_deref(), Some("P/snare 1.wav"));
        assert!(
            out["P/mystery.wav"].words.is_empty(),
            "a second-hand label should not have travelled"
        );
    }

    #[test]
    fn the_most_confident_sibling_is_the_one_asked() {
        let mut known = BTreeMap::new();
        known.insert("P/h 1.wav".into(), heard(&[("Cymbal", 0.20)]));
        known.insert("P/h 2.wav".into(), heard(&[("Hi-hat", 0.80)]));
        known.insert("P/h 3.wav".into(), heard(&[]));

        let out = propagate(&known, |_| none());
        assert_eq!(out["P/h 3.wav"].from.as_deref(), Some("P/h 2.wav"));
    }

    #[test]
    fn a_library_where_nothing_was_recognised_is_left_as_it_is() {
        let mut known = BTreeMap::new();
        known.insert("P/a.wav".into(), heard(&[]));
        known.insert("P/b.wav".into(), heard(&[]));
        let out = propagate(&known, |_| vec!["P/a.wav".into(), "P/b.wav".into()]);
        assert_eq!(out, known);
    }
}
