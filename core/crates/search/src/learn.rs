//! Learning what your own words mean.
//!
//! The classifier knows AudioSet's 521 nouns and nothing else. It will never
//! say "time stretched" or "vocal stretch", because those are not categories of
//! sound in the world — they are categories in *your* work, and only you know
//! which sounds belong to them.
//!
//! So it is taught by example. Put "time stretched" on a sound and that sound
//! becomes an exemplar. Any other sound close enough to an exemplar gets the
//! tag suggested, with the exemplar named, so a suggestion can always be
//! checked against the thing it was inferred from. Tag a second sound and the
//! tag gets a second way to be recognised.
//!
//! No model, no training, nothing to retrain — the fingerprints already exist
//! and this is a nearest-neighbour vote over them. That matters: a tag applied
//! once starts working immediately, and a tag applied to the wrong sound stops
//! working the moment it is removed. Nothing is baked in.
//!
//! The honest limit is the fingerprint's. These twelve numbers describe
//! texture, so a tag that tracks texture — "gritty", "sub heavy", "time
//! stretched" — will spread well. A tag that depends on where a sound came from
//! or what it will be used for cannot be inferred from the audio at all, and
//! will only ever sit on the sounds you put it on. That is not a failure to fix
//! by lowering the threshold; it is the difference between the two kinds of
//! tag, and lowering the threshold would just spread it at random.

use crate::Fingerprint;
use std::collections::BTreeMap;

/// A tag worth offering for a sound, and the evidence for offering it.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub tag: String,
    /// How much this sound is like the closest sound carrying the tag.
    pub score: f32,
    /// That sound. Named so the suggestion can be judged rather than trusted.
    pub like: String,
    /// How many tagged sounds agree, this close or closer. One is a
    /// coincidence; four is a pattern.
    pub support: usize,
}

/// How alike two sounds must be before a tag is *offered* from one to the other.
///
/// Looser than the threshold used for labels that apply themselves, and
/// deliberately so — the two are not the same risk. A propagated label appears
/// on a sound whether or not anyone looks at it, so being wrong is expensive
/// and it is set at 0.95. A learned tag is a proposal with the sound it came
/// from named next to it, and does not exist until it is clicked. Being wrong
/// there costs a glance; being too strict costs the whole feature.
///
/// Measured rather than guessed. The five snares in the test library sit
/// between 0.85 and 0.91 of each other, and the first unrelated sound — a drum
/// loop — is at 0.838. There is not much daylight between those, which is a
/// fact about twelve-dimensional fingerprints and not something a threshold can
/// fix. Anything that slips through is one click to ignore, and anything missed
/// is one tag away from being learned properly, because tagging it by hand
/// makes it an example too.
pub const LEARN: f32 = 0.85;

/// The stricter bar, for anything that applies itself without being asked.
pub const NEAR: f32 = 0.95;

/// Offer tags for `query`, learned from the sounds already carrying them.
///
/// `tagged` is every (path, tag) a person has applied, with that sound's
/// fingerprint. The query's own tags are not offered back to it.
pub fn suggest<'a, I>(
    query: &Fingerprint,
    tagged: I,
    exclude: &str,
    near: f32,
    limit: usize,
) -> Vec<Suggestion>
where
    I: IntoIterator<Item = (&'a str, &'a str, Fingerprint)>,
{
    // Best evidence per tag, and how many exemplars back it.
    let mut best: BTreeMap<String, (f32, String, usize)> = BTreeMap::new();

    for (path, tag, fp) in tagged {
        if path == exclude {
            continue;
        }
        let score = query.similarity(&fp);
        if score < near {
            continue;
        }
        let slot = best
            .entry(tag.to_string())
            .or_insert_with(|| (0.0, String::new(), 0));
        slot.2 += 1;
        if score > slot.0 {
            slot.0 = score;
            slot.1 = path.to_string();
        }
    }

    let mut out: Vec<Suggestion> = best
        .into_iter()
        .map(|(tag, (score, like, support))| Suggestion { tag, score, like, support })
        .collect();

    // Strongest first; agreement breaks a tie, then the name, so the order
    // never depends on which way a map happened to iterate.
    out.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(b.support.cmp(&a.support))
            .then(a.tag.cmp(&b.tag))
    });
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DIMS;

    /// A fingerprint that differs from `base` by `d` in every dimension.
    fn near_to(base: f32, d: f32) -> Fingerprint {
        let mut v = [base; DIMS];
        v[0] += d;
        Fingerprint { v }
    }

    fn fp(base: f32) -> Fingerprint {
        Fingerprint { v: [base; DIMS] }
    }

    #[test]
    fn a_tag_carries_to_a_sound_that_is_close_enough() {
        let query = fp(0.5);
        let out = suggest(
            &query,
            [("P/stretched 1.wav", "time stretched", near_to(0.5, 0.01))],
            "P/other.wav",
            NEAR,
            5,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].tag, "time stretched");
        assert_eq!(out[0].like, "P/stretched 1.wav");
        assert_eq!(out[0].support, 1);
    }

    #[test]
    fn a_tag_does_not_carry_to_something_that_sounds_nothing_like_it() {
        let out = suggest(
            &fp(0.1),
            [("P/stretched 1.wav", "time stretched", fp(0.9))],
            "",
            NEAR,
            5,
        );
        assert!(out.is_empty(), "a distant sound should not inherit a tag");
    }

    #[test]
    fn a_sound_is_not_offered_a_tag_it_already_carries() {
        let out = suggest(
            &fp(0.5),
            [("P/a.wav", "vocal stretch", fp(0.5))],
            "P/a.wav",
            NEAR,
            5,
        );
        assert!(out.is_empty());
    }

    #[test]
    fn more_exemplars_agreeing_raises_the_support() {
        let out = suggest(
            &fp(0.5),
            [
                ("P/a.wav", "gritty", near_to(0.5, 0.005)),
                ("P/b.wav", "gritty", near_to(0.5, 0.01)),
                ("P/c.wav", "gritty", near_to(0.5, 0.02)),
            ],
            "",
            NEAR,
            5,
        );
        assert_eq!(out[0].support, 3);
        // The named exemplar is the closest one, not the first seen.
        assert_eq!(out[0].like, "P/a.wav");
    }

    #[test]
    fn the_strongest_evidence_is_offered_first() {
        let out = suggest(
            &fp(0.5),
            [
                ("P/a.wav", "far", near_to(0.5, 0.05)),
                ("P/b.wav", "near", near_to(0.5, 0.001)),
            ],
            "",
            0.5,
            5,
        );
        assert_eq!(out[0].tag, "near");
    }

    #[test]
    fn ties_resolve_the_same_way_every_time() {
        let a = suggest(
            &fp(0.5),
            [("P/a.wav", "zebra", fp(0.5)), ("P/b.wav", "aardvark", fp(0.5))],
            "",
            NEAR,
            5,
        );
        let b = suggest(
            &fp(0.5),
            [("P/b.wav", "aardvark", fp(0.5)), ("P/a.wav", "zebra", fp(0.5))],
            "",
            NEAR,
            5,
        );
        assert_eq!(a, b);
        assert_eq!(a[0].tag, "aardvark");
    }

    #[test]
    fn nothing_tagged_yet_means_nothing_suggested() {
        assert!(suggest(&fp(0.5), [], "", NEAR, 5).is_empty());
    }

    #[test]
    fn the_offer_is_capped() {
        let held: Vec<(String, String, Fingerprint)> = (0..10)
            .map(|i| (format!("P/{i}.wav"), format!("tag{i}"), fp(0.5)))
            .collect();
        let out = suggest(
            &fp(0.5),
            held.iter().map(|(p, t, f)| (p.as_str(), t.as_str(), *f)),
            "",
            NEAR,
            3,
        );
        assert_eq!(out.len(), 3);
    }
}
