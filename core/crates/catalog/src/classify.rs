//! What kind of sound is this?
//!
//! A port of the taxonomy documented in `INGEST-TAXONOMY.md`. The rules are
//! ordered as a ladder: the first one that fires wins, and each records why in
//! `reasons` so the browser can justify a grouping to the user.
//!
//! Nothing here renames, moves or deletes anything. A classification is an
//! opinion attached to a file, never a change to it.

use crate::text::{series_parts, Text};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Cache,
    Document,
    Broken,
    UnknownFormat,
    Song,
    /// Looks like a song but something contradicts it.
    SongUncertain,
    LongSession,
    SessionTake,
    Stem,
    Vocal,
    DrumOneshot,
    DrumHitLong,
    Fx,
    PadBed,
    SynthStab,
    Chop,
    Loop,
    TonalHit,
    OneShot,
    SampleShort,
    Sample,
    SectionBed,
    Unknown,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Cache => "CACHE",
            Category::Document => "DOCUMENT",
            Category::Broken => "BROKEN",
            Category::UnknownFormat => "UNKNOWN-FORMAT",
            Category::Song => "SONG",
            Category::SongUncertain => "SONG?",
            Category::LongSession => "LONG-SESSION",
            Category::SessionTake => "SESSION-TAKE",
            Category::Stem => "STEM",
            Category::Vocal => "VOCAL",
            Category::DrumOneshot => "DRUM-ONESHOT",
            Category::DrumHitLong => "DRUM-HIT-LONG",
            Category::Fx => "FX",
            Category::PadBed => "PAD-BED",
            Category::SynthStab => "SYNTH-STAB",
            Category::Chop => "CHOP",
            Category::Loop => "LOOP",
            Category::TonalHit => "TONAL-HIT",
            Category::OneShot => "ONE-SHOT",
            Category::SampleShort => "SAMPLE-SHORT",
            Category::Sample => "SAMPLE",
            Category::SectionBed => "SECTION-BED",
            Category::Unknown => "UNKNOWN",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    High,
    Medium,
    Low,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::High => "high",
            Confidence::Medium => "medium",
            Confidence::Low => "low",
        }
    }
}

/// Membership of a numbered run of files, e.g. "chop 01".."chop 24".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Series {
    pub root: String,
    pub index: u32,
    pub size: usize,
}

/// Everything the classifier is allowed to look at.
#[derive(Debug, Clone)]
pub struct FileFacts<'a> {
    pub stem: &'a str,
    /// Lowercase, with the leading dot.
    pub ext: &'a str,
    /// Enclosing folders, outermost first.
    pub folder_chain: &'a [&'a str],
    pub duration: f64,
    /// False when the header could not be parsed at all.
    pub readable: bool,
    pub series: Option<Series>,
}

#[derive(Debug, Clone)]
pub struct Classification {
    pub category: Category,
    pub confidence: Confidence,
    pub machine: Option<String>,
    pub instrument: Option<String>,
    pub descriptors: Vec<String>,
    pub bpm: Option<u32>,
    pub folder_role: Option<&'static str>,
    pub reasons: Vec<String>,
}

const CACHE_EXT: &[&str] = &[
    ".asd", ".ovw", ".nov", ".reapeaks", ".pkf", ".sfk", ".db", ".ini", ".ds_store", ".tmp", ".bak",
];
const DOC_EXT: &[&str] = &[
    ".txt", ".md", ".pdf", ".rtf", ".doc", ".docx", ".html", ".tsv", ".csv", ".nfo",
];

/// Drum machines and samplers, most specific first. A model number written
/// bare ("808") only counts when it stands alone as its own token.
fn detect_machine(t: &Text) -> Option<&'static str> {
    const MODELS: &[(&str, &str, &str)] = &[
        ("tr", "808", "TR-808"),
        ("tr", "909", "TR-909"),
        ("tr", "707", "TR-707"),
        ("tr", "727", "TR-727"),
        ("tr", "606", "TR-606"),
        ("tr", "505", "TR-505"),
        ("cr", "78", "CR-78"),
        ("sp", "1200", "E-mu SP-1200"),
        ("sp", "12", "E-mu SP-12"),
        ("mc", "303", "Roland MC-303"),
        ("lm", "1", "LinnDrum LM-1"),
    ];
    for (prefix, digits, name) in MODELS {
        if t.has_model(prefix, digits) {
            return Some(name);
        }
    }
    // Bare model numbers, only for the unambiguous ones.
    for (digits, name) in [("808", "TR-808"), ("909", "TR-909"), ("707", "TR-707")] {
        if t.has_bare_number(digits) {
            return Some(name);
        }
    }

    const NAMED: &[(&[&str], &str)] = &[
        (&["linndrum", "linn"], "LinnDrum LM-1"),
        (&["mpc"], "Akai MPC"),
        (&["dmx"], "Oberheim DMX"),
        (&["drumulator"], "E-mu Drumulator"),
        (&["simmons"], "Simmons"),
        (&["vermona"], "Vermona DRM1"),
        (&["acetone"], "Acetone Rhythm"),
        (&["machinedrum"], "Elektron Machinedrum"),
        (&["electribe"], "Korg Electribe"),
        (&["percusyn"], "AJK Percusyn"),
        (&["serge"], "Serge Modular"),
        (&["moog"], "Moog Modular"),
        (&["synsonics"], "Mattel Synsonics"),
        (&["checkmate"], "Keio Checkmate"),
        (&["oberheim"], "Oberheim"),
        (&["alesis"], "Alesis"),
        (&["akai"], "Akai"),
        (&["korg"], "Korg"),
        (&["emu"], "E-mu"),
        (&["battery"], "NI Battery"),
        (&["absynth"], "NI Absynth"),
        (&["kontakt"], "NI Kontakt"),
        (&["halion"], "Halion"),
    ];
    for (words, name) in NAMED {
        if t.has_any(words) {
            return Some(name);
        }
    }
    if t.has_phrase("rhythm ace") {
        return Some("Acetone Rhythm Ace");
    }
    if t.has_phrase("rhythm king") {
        return Some("Acetone Rhythm King");
    }
    if t.has_phrase("sds 2000") || t.has("sds2000") {
        return Some("Simmons SDS2000");
    }
    None
}

/// Multi-word instrument names, tested before the single-token table below.
/// "closed hat" has to be recognised as a phrase, otherwise its bare "hat"
/// token matches first and the open/closed distinction is lost.
const INSTRUMENT_PHRASES: &[(&[&str], &str)] = &[
    (
        &["closed hat", "hat closed", "cl hat", "hh cl", "hat cl", "closed hh"],
        "Hat Closed",
    ),
    (
        &["open hat", "hat open", "op hat", "hh op", "hat op", "open hh"],
        "Hat Open",
    ),
    (&["bass drum", "kick drum"], "Kick"),
    (&["hand clap"], "Clap"),
    (&["side stick"], "Rim"),
    (&["floor tom"], "Tom"),
    (&["hi hat", "hi hats"], "Hat"),
];

const INSTRUMENTS: &[(&[&str], &str)] = &[
    (&["chh", "hatc", "closedhat"], "Hat Closed"),
    (&["ohh", "openhat"], "Hat Open"),
    (&["bd", "kick", "kik", "bassdrum"], "Kick"),
    (&["sd", "snare", "sn", "snr"], "Snare"),
    (&["rim", "rs", "rimshot", "sidestick"], "Rim"),
    (&["cp", "clap", "claps", "handclap"], "Clap"),
    (&["tom", "lowtom", "hitom", "midtom"], "Tom"),
    (&["crash", "crsh", "cym", "cymbal"], "Crash"),
    (&["ride", "rd"], "Ride"),
    (&["cb", "cowbell"], "Cowbell"),
    (&["clave", "claves"], "Clave"),
    (&["conga", "bongo", "tumba"], "Conga"),
    (&["shaker", "maraca", "cabasa", "guiro"], "Shaker"),
    (&["tamb", "tambourine"], "Tambourine"),
    (&["hh", "hat", "hihat"], "Hat"),
    (&["perc", "percussion"], "Perc"),
    (&["stick", "click"], "Stick"),
    (&["bass", "sub"], "Bass"),
    (
        &["lead", "arp", "pluck", "key", "keys", "piano", "organ", "rhodes"],
        "Melodic",
    ),
    (
        &["string", "strings", "brass", "horn", "flute", "violin", "cello"],
        "Orchestral",
    ),
    (
        &["vox", "vocal", "voice", "speech", "spoken", "acapella"],
        "Vocal",
    ),
    (&["noise", "white", "pink"], "Noise"),
];

const DRUMS: &[&str] = &[
    "Kick",
    "Snare",
    "Hat",
    "Hat Closed",
    "Hat Open",
    "Clap",
    "Tom",
    "Rim",
    "Crash",
    "Ride",
    "Cowbell",
    "Clave",
    "Conga",
    "Shaker",
    "Tambourine",
    "Perc",
    "Stick",
];

const DESCRIPTORS: &[&str] = &[
    "hrd", "hard", "med", "medium", "sft", "soft", "lite", "light", "loud", "quiet", "dry", "wet",
    "amb", "ambient", "verb", "reverb", "gated", "room", "comp", "compressed", "eq", "long",
    "short", "dec", "decay", "tight", "open", "closed", "mute", "muted", "roll", "flam",
];

const SONG_WORDS: &[&str] = &[
    "master", "mastered", "final", "finals", "mixdown", "mixed", "mstr", "album", "remaster",
];
const LOOP_WORDS: &[&str] = &["loop", "lp", "groove", "beat", "break", "bar", "bars", "riff"];
const PAD_WORDS: &[&str] = &[
    "pad", "drone", "atmos", "atmosphere", "ambient", "amb", "texture", "bed", "wash", "swell",
    "soundscape", "field",
];
const FX_WORDS: &[&str] = &[
    "fx", "sweep", "riser", "rise", "fall", "impact", "whoosh", "zap", "glitch", "stutter",
    "transition", "uplifter",
];
const STAB_WORDS: &[&str] = &["stab", "hit", "chord", "shot", "blast", "jab"];
const SESS_WORDS: &[&str] = &[
    "take", "takes", "session", "sessions", "rec", "recording", "live", "jam", "improv",
    "rehearsal", "raw",
];
const STEM_WORDS: &[&str] = &["stem", "stems", "part", "parts", "track", "tracks", "bounce", "print"];

const FOLDER_ROLES: &[(&[&str], &str)] = &[
    (&["kit", "kits"], "kit"),
    (&["master", "masters", "final", "finals"], "masters"),
    (&["session", "sessions", "takes", "recordings"], "sessions"),
    (&["chop", "chops", "slice", "slices"], "chops"),
    (&["loop", "loops"], "loops"),
    (&["sample", "samples"], "samples"),
    (&["edit", "edits"], "edits"),
    (&["archive", "old"], "archive"),
    (&["mp3", "render", "renders", "bounce"], "renders"),
    (&["patch", "patches", "preset", "presets"], "patches"),
];

fn detect_instrument(t: &Text) -> Option<&'static str> {
    for (phrases, label) in INSTRUMENT_PHRASES {
        if phrases.iter().any(|p| t.has_phrase(p)) {
            return Some(label);
        }
    }
    INSTRUMENTS
        .iter()
        .find(|(words, _)| t.has_any(words))
        .map(|(_, label)| *label)
}

pub fn classify(f: &FileFacts<'_>) -> Classification {
    let ext = f.ext.to_ascii_lowercase();
    let mut reasons: Vec<String> = Vec::new();

    // Non-audio and unreadable files short-circuit before any guessing.
    if CACHE_EXT.contains(&ext.as_str()) {
        return terminal(Category::Cache, vec![format!("cache extension {ext}")]);
    }
    if DOC_EXT.contains(&ext.as_str()) {
        return terminal(Category::Document, vec![format!("document extension {ext}")]);
    }
    if !f.readable {
        return terminal(
            Category::Broken,
            vec!["header could not be read".to_string()],
        );
    }

    let name = Text::new(f.stem);
    let folders = Text::from_parts(f.folder_chain);
    let context = Text::from_parts(&[&f.folder_chain.join(" "), f.stem]);

    // A machine named in the filename is direct evidence; one inherited from the
    // folder is weaker, and the difference is recorded.
    let machine = match detect_machine(&name) {
        Some(m) => {
            reasons.push(format!("machine {m} in name"));
            Some(m.to_string())
        }
        None => detect_machine(&folders).map(|m| {
            reasons.push(format!("machine {m} from folder"));
            m.to_string()
        }),
    };

    let instrument = detect_instrument(&name).map(|label| {
        reasons.push(format!("instrument token {label}"));
        label.to_string()
    });

    let descriptors: Vec<String> = DESCRIPTORS
        .iter()
        .filter(|d| name.has(d))
        .map(|d| d.to_string())
        .collect();

    let bpm = name.bpm();
    if let Some(b) = bpm {
        reasons.push(format!("{b} bpm in name"));
    }

    let folder_role = FOLDER_ROLES
        .iter()
        .find(|(words, _)| folders.has_any(words))
        .map(|(_, role)| {
            reasons.push(format!("folder role {role}"));
            *role
        });

    let dur = f.duration;
    let is_drum = instrument.as_deref().map_or(false, |i| DRUMS.contains(&i));

    let finish = |category, confidence, extra: Vec<String>, reasons: Vec<String>| Classification {
        category,
        confidence,
        machine: machine.clone(),
        instrument: instrument.clone(),
        descriptors: descriptors.clone(),
        bpm,
        folder_role,
        reasons: reasons.into_iter().chain(extra).collect(),
    };

    // ---- the ladder

    if context.has_any(SONG_WORDS) {
        return if dur >= 90.0 || dur == 0.0 {
            finish(
                Category::Song,
                Confidence::High,
                vec!["song keyword and full length".into()],
                reasons,
            )
        } else {
            finish(
                Category::SongUncertain,
                Confidence::Low,
                vec![format!("song keyword but only {dur:.1}s")],
                reasons,
            )
        };
    }

    if matches!(folder_role, Some("masters") | Some("renders")) && dur >= 90.0 {
        return finish(
            Category::Song,
            Confidence::High,
            vec!["long file in a masters folder".into()],
            reasons,
        );
    }

    if dur >= 300.0 {
        return finish(
            Category::LongSession,
            Confidence::Medium,
            vec!["over five minutes".into()],
            reasons,
        );
    }

    if dur >= 90.0 {
        if context.has_any(SESS_WORDS) {
            return finish(
                Category::SessionTake,
                Confidence::Medium,
                vec!["session keyword and long".into()],
                reasons,
            );
        }
        if context.has_any(STEM_WORDS) {
            return finish(
                Category::Stem,
                Confidence::Medium,
                vec!["stem keyword and long".into()],
                reasons,
            );
        }
        return finish(
            Category::SongUncertain,
            Confidence::Low,
            vec!["90s to 5m with no keyword".into()],
            reasons,
        );
    }

    if instrument.as_deref() == Some("Vocal") {
        let c = if dur > 0.0 && dur < 30.0 {
            Confidence::Medium
        } else {
            Confidence::Low
        };
        return finish(Category::Vocal, c, vec![], reasons);
    }

    // A drum token on a short file outranks series numbering, because kits are
    // numbered too and would otherwise all be misread as chops.
    if is_drum && dur > 0.0 && dur < 3.0 {
        let mut extra = vec![format!("drum token at {dur:.2}s")];
        if f.series.is_some() {
            extra.push("numbered, but drum token wins".into());
        }
        let c = if machine.is_some() {
            Confidence::High
        } else {
            Confidence::Medium
        };
        return finish(Category::DrumOneshot, c, extra, reasons);
    }

    if dur > 0.0 && dur < 1.0 && (folder_role == Some("kit") || machine.is_some()) {
        return finish(
            Category::DrumOneshot,
            Confidence::Medium,
            vec!["under a second in a kit or machine context".into()],
            reasons,
        );
    }

    if context.has_any(FX_WORDS) {
        return finish(Category::Fx, Confidence::Medium, vec!["fx keyword".into()], reasons);
    }

    if context.has_any(PAD_WORDS) && dur >= 8.0 {
        return finish(
            Category::PadBed,
            Confidence::Medium,
            vec!["pad keyword and sustained".into()],
            reasons,
        );
    }

    if context.has_any(STAB_WORDS) && dur > 0.0 && dur < 8.0 {
        return finish(
            Category::SynthStab,
            Confidence::Medium,
            vec!["stab keyword".into()],
            reasons,
        );
    }

    if let Some(s) = &f.series {
        if s.size >= 3 && dur > 0.3 && dur < 20.0 && !is_drum {
            return finish(
                Category::Chop,
                Confidence::Medium,
                vec![format!(
                    "numbered series \"{}\" ({} of {}), no drum token",
                    s.root, s.index, s.size
                )],
                reasons,
            );
        }
    }

    if context.has_any(LOOP_WORDS) || bpm.is_some() {
        return finish(
            Category::Loop,
            Confidence::Medium,
            vec!["loop keyword or bpm".into()],
            reasons,
        );
    }

    if is_drum && dur > 0.0 && dur < 8.0 {
        return finish(
            Category::DrumHitLong,
            Confidence::Low,
            vec![format!("drum token at {dur:.1}s")],
            reasons,
        );
    }

    if instrument.is_some() && dur > 0.0 && dur < 8.0 {
        return finish(
            Category::TonalHit,
            Confidence::Low,
            vec![format!("instrument token at {dur:.1}s")],
            reasons,
        );
    }

    // Nothing in the name said anything. Fall back to duration alone, and mark
    // it low confidence so the browser can colour it as a suggestion.
    let (cat, why) = if dur <= 0.0 {
        (Category::Unknown, "no duration and no signal".to_string())
    } else if dur < 1.0 {
        (Category::OneShot, format!("{dur:.2}s, untyped"))
    } else if dur < 8.0 {
        (Category::SampleShort, format!("{dur:.1}s, untyped"))
    } else if dur < 30.0 {
        (Category::Sample, format!("{dur:.1}s, untyped"))
    } else {
        (Category::SectionBed, format!("{dur:.0}s, untyped"))
    };
    finish(cat, Confidence::Low, vec![why], reasons)
}

fn terminal(category: Category, reasons: Vec<String>) -> Classification {
    Classification {
        category,
        confidence: Confidence::High,
        machine: None,
        instrument: None,
        descriptors: Vec::new(),
        bpm: None,
        folder_role: None,
        reasons,
    }
}

/// Group files sharing a numbered base name, so "chop 01".."chop 24" are seen
/// as one series. Returns, for each input stem, its series membership.
pub fn detect_series(stems: &[String]) -> Vec<Option<Series>> {
    use std::collections::HashMap;
    let parsed: Vec<Option<(String, u32)>> = stems.iter().map(|s| series_parts(s)).collect();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for p in parsed.iter().flatten() {
        *counts.entry(p.0.as_str()).or_insert(0) += 1;
    }
    parsed
        .iter()
        .map(|p| {
            p.as_ref().and_then(|(root, index)| {
                let size = *counts.get(root.as_str())?;
                // A single numbered file is not a series.
                (size >= 2).then(|| Series {
                    root: root.clone(),
                    index: *index,
                    size,
                })
            })
        })
        .collect()
}
