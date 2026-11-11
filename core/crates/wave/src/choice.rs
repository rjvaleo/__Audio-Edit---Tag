//! Choice keys as mod targets (v8b): the warp modes, the oscillator effects,
//! the filter types, the filter routing, the LFO shapes and the tables.
//!
//! # The rule
//!
//! Each choice's options are an ordered list, as `docs/WAVE-SYNTH.md` lists
//! them. The option the patch has is an index into that list, normalised to
//! 0..1 over it; the rows for the key are summed onto it (`amt · curve(src) ·
//! via`, as a numeric row is), the sum is clamped once to 0..1, and the result
//! is **stepped** to the nearest option. So `+1` on a warp mode set to `off`
//! takes it to `fm`, the last of nine, and an LFO at ±1 with `amt` 0.5 swings
//! a mode set in the middle of its list across all of it.
//!
//! # Where the step is heard
//!
//! At the next control block, like every other modulation. Per voice for the
//! keys each voice plays for itself (warp modes, oscillator effects, filter
//! types, tables, and the shape of a Trig or Env LFO), with that voice's
//! sources; once for every voice for the keys there is one of (the routing,
//! and a free LFO's shape), with the shared sources. How each change is made
//! without a click is the voice's business (`voice.rs`).
//!
//! # The table bank
//!
//! `oscN.table` steps through the bank: the five built-in tables, then every
//! table assigned to an oscillator that is not one of them, each once, in
//! oscillator order. An oscillator's own table is its base option. The bank
//! is worked out from the patch's table names when it is compiled; the tables
//! themselves are built off the audio thread and handed to the synth
//! (`Synth::set_bank_table`), and an oscillator stepped to one not yet there
//! keeps playing its own.
//!
//! # Not targets
//!
//! `voice.mode`, `oscN.route` and `lfoL.mode` change how voices are allocated
//! or what an LFO is, not a sound; they stay as the patch sets them.

use crate::patch::{Curve, FilterRoute, FilterType, FxMode, LfoWave, Patch, Source, MAX_MODS, SRC_COUNT};
use crate::table::BUILTIN_NAMES;
use crate::warp::WarpMode;

/// The choice keys that are mod targets.
pub const CHOICES: usize = 19;

/// Every choice target. Its index is its [`ChoiceId`] and the constants below.
pub static CHOICE_KEYS: [&str; CHOICES] = [
    "osc0.warp0.mode",
    "osc0.warp1.mode",
    "osc0.fx.mode",
    "osc0.table",
    "osc1.warp0.mode",
    "osc1.warp1.mode",
    "osc1.fx.mode",
    "osc1.table",
    "osc2.warp0.mode",
    "osc2.warp1.mode",
    "osc2.fx.mode",
    "osc2.table",
    "filt0.type",
    "filt1.type",
    "filt.route",
    "lfo0.shape",
    "lfo1.shape",
    "lfo2.shape",
    "lfo3.shape",
];

/// Oscillator *N*'s keys start at `N · C_OSC_STRIDE`: two warp modes, the
/// effect, the table.
pub const C_OSC_STRIDE: usize = 4;
pub const C_WARP: usize = 0;
pub const C_FX: usize = 2;
pub const C_TABLE: usize = 3;
pub const C_FILT: usize = 12;
pub const C_ROUTE: usize = 14;
pub const C_LFO: usize = 15;

/// The bank's most tables: the five built-ins and one for each oscillator.
pub const BANK: usize = 8;

#[inline]
pub const fn osc_choice(osc: usize, field: usize) -> usize {
    osc * C_OSC_STRIDE + field
}

/// A choice key's index in [`CHOICE_KEYS`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChoiceId(pub u8);

impl ChoiceId {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
    pub fn key(self) -> &'static str {
        CHOICE_KEYS.get(self.index()).copied().unwrap_or("")
    }
}

/// The id of a choice key. Never allocates.
pub fn choice_id(key: &str) -> Option<ChoiceId> {
    CHOICE_KEYS.iter().position(|k| *k == key).map(|i| ChoiceId(i as u8))
}

/// One place in the bank.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BankEntry {
    /// A built-in, by its index in [`BUILTIN_NAMES`].
    Builtin(u8),
    /// The table oscillator *N* was given.
    Osc(u8),
}

/// The bank for these oscillator tables: its entries, how many, and each
/// oscillator's own place in it.
pub fn table_bank(tables: &[String; 3]) -> ([BankEntry; BANK], usize, [u8; 3]) {
    let mut bank = [BankEntry::Builtin(0); BANK];
    for (i, e) in bank.iter_mut().enumerate().take(BUILTIN_NAMES.len()) {
        *e = BankEntry::Builtin(i as u8);
    }
    let mut len = BUILTIN_NAMES.len();
    let mut own = [0u8; 3];
    for o in 0..3 {
        let name = tables[o].as_str();
        if let Some(i) = BUILTIN_NAMES.iter().position(|b| *b == name) {
            own[o] = i as u8;
        } else if let Some(p) = (0..o).find(|&p| tables[p] == name && !BUILTIN_NAMES.contains(&tables[p].as_str())) {
            own[o] = own[p];
        } else {
            bank[len] = BankEntry::Osc(o as u8);
            own[o] = len as u8;
            len += 1;
        }
    }
    (bank, len, own)
}

/// The bank's table names, in order, for the server to name a step with.
pub fn bank_names(tables: &[String; 3]) -> Vec<String> {
    let (bank, len, _) = table_bank(tables);
    bank[..len]
        .iter()
        .map(|e| match *e {
            BankEntry::Builtin(i) => BUILTIN_NAMES[i as usize].to_string(),
            BankEntry::Osc(o) => tables[o as usize].clone(),
        })
        .collect()
}

/// An option of a choice key by its index, as the patch names it. Tables are
/// named by the bank; `None` for a table here, or an index past the list.
pub fn option_name(id: ChoiceId, index: usize) -> Option<&'static str> {
    let i = id.index();
    match i {
        C_FILT | 13 => FilterType::ALL.get(index).map(|t| t.as_str()),
        C_ROUTE => FilterRoute::ALL.get(index).map(|r| r.as_str()),
        _ if i >= C_LFO => LfoWave::ALL.get(index).map(|w| w.as_str()),
        _ => match i % C_OSC_STRIDE {
            C_FX => FxMode::ALL.get(index).map(|m| m.as_str()),
            C_TABLE => None,
            _ => WarpMode::ALL.get(index).map(|m| m.as_str()),
        },
    }
}

/// Is this key the same for every voice: the routing, or the shape of an
/// LFO running free?
pub fn is_shared(id: usize, lfo_free: [bool; 4]) -> bool {
    id == C_ROUTE || (id >= C_LFO && lfo_free[id - C_LFO])
}

/// One compiled row onto a choice key.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChoiceRow {
    pub src: Source,
    pub dst: u8,
    pub amt: f32,
    pub curve: Curve,
    pub via: Option<Source>,
}

/// The choice half of a compiled patch. Plain data; no heap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Choices {
    rows: [ChoiceRow; MAX_MODS],
    count: usize,
    /// Each key's option as the patch sets it.
    pub base: [u8; CHOICES],
    /// How many options each key has (the bank's length for a table).
    pub len: [u8; CHOICES],
    /// The keys that have rows, a bit each.
    pub touched: u32,
    pub bank: [BankEntry; BANK],
    pub bank_len: usize,
}

const _: () = assert!(CHOICES <= 32);

impl Choices {
    /// Compile the patch's rows onto choice keys, and its options. Rows
    /// switched off, or naming an unknown source, curve or via, are skipped.
    pub fn new(patch: &Patch) -> Choices {
        let blank = ChoiceRow { src: Source(0), dst: 0, amt: 0.0, curve: Curve::Lin, via: None };
        let mut rows = [blank; MAX_MODS];
        let mut count = 0;
        let mut touched = 0u32;
        for m in patch.mods.iter().filter(|m| m.on) {
            if count == MAX_MODS {
                break;
            }
            let (Some(src), Some(dst)) = (Source::parse(&m.src), choice_id(&m.dst)) else { continue };
            let Some(curve) = Curve::parse(if m.curve.is_empty() { "lin" } else { &m.curve }) else { continue };
            let via = match m.via.as_deref() {
                None | Some("") => None,
                Some(v) => match Source::parse(v) {
                    Some(s) => Some(s),
                    None => continue,
                },
            };
            if !m.amt.is_finite() {
                continue;
            }
            rows[count] = ChoiceRow { src, dst: dst.0, amt: m.amt.clamp(-1.0, 1.0), curve, via };
            touched |= 1 << dst.0;
            count += 1;
        }
        let (bank, bank_len, own) = table_bank(&patch.tables);
        let mut base = [0u8; CHOICES];
        let mut len = [0u8; CHOICES];
        for o in 0..3 {
            for j in 0..2 {
                base[osc_choice(o, C_WARP + j)] = index(&WarpMode::ALL, patch.warp_modes[o][j]);
                len[osc_choice(o, C_WARP + j)] = WarpMode::ALL.len() as u8;
            }
            base[osc_choice(o, C_FX)] = index(FxMode::ALL, patch.fx_modes[o]);
            len[osc_choice(o, C_FX)] = FxMode::ALL.len() as u8;
            base[osc_choice(o, C_TABLE)] = own[o];
            len[osc_choice(o, C_TABLE)] = bank_len as u8;
        }
        for f in 0..2 {
            base[C_FILT + f] = index(FilterType::ALL, patch.filter_types[f]);
            len[C_FILT + f] = FilterType::ALL.len() as u8;
        }
        base[C_ROUTE] = index(FilterRoute::ALL, patch.filter_route);
        len[C_ROUTE] = FilterRoute::ALL.len() as u8;
        for l in 0..4 {
            base[C_LFO + l] = index(LfoWave::ALL, patch.lfo_waves[l]);
            len[C_LFO + l] = LfoWave::ALL.len() as u8;
        }
        Choices { rows, count, base, len, touched, bank, bank_len }
    }

    pub fn rows(&self) -> &[ChoiceRow] {
        &self.rows[..self.count]
    }

    /// Every key's option with these sources: the base for a key with no
    /// rows, the stepped sum for one with them. No allocation.
    #[inline]
    pub fn modulate(&self, src: &[f32; SRC_COUNT], out: &mut [u8; CHOICES]) {
        *out = self.base;
        if self.touched == 0 {
            return;
        }
        let mut acc = [0.0f32; CHOICES];
        for row in self.rows() {
            let via = row.via.map_or(1.0, |s| src[s.index()]);
            acc[row.dst as usize] += row.amt * row.curve.apply(src[row.src.index()]) * via;
        }
        let mut bits = self.touched;
        while bits != 0 {
            let d = bits.trailing_zeros() as usize;
            bits &= bits - 1;
            out[d] = step(self.base[d], self.len[d], acc[d]);
        }
    }
}

fn index<T: PartialEq + Copy>(all: &[T], v: T) -> u8 {
    all.iter().position(|x| *x == v).unwrap_or(0) as u8
}

/// The rule: `base` of `len` options, normalised, moved by `sum`, clamped,
/// stepped to the nearest option.
#[inline]
pub fn step(base: u8, len: u8, sum: f32) -> u8 {
    if len <= 1 {
        return 0;
    }
    let top = (len - 1) as f32;
    let n = (base as f32 / top + sum).clamp(0.0, 1.0);
    // The kit's Math.round: halves go up.
    ((n * top + 0.5).floor() as u8).min(len - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keys_and_their_constants_agree() {
        for o in 0..3 {
            assert_eq!(CHOICE_KEYS[osc_choice(o, C_WARP)], format!("osc{o}.warp0.mode"));
            assert_eq!(CHOICE_KEYS[osc_choice(o, C_WARP + 1)], format!("osc{o}.warp1.mode"));
            assert_eq!(CHOICE_KEYS[osc_choice(o, C_FX)], format!("osc{o}.fx.mode"));
            assert_eq!(CHOICE_KEYS[osc_choice(o, C_TABLE)], format!("osc{o}.table"));
        }
        assert_eq!(CHOICE_KEYS[C_FILT + 1], "filt1.type");
        assert_eq!(CHOICE_KEYS[C_ROUTE], "filt.route");
        assert_eq!(CHOICE_KEYS[C_LFO + 3], "lfo3.shape");
        assert_eq!(option_name(ChoiceId(C_LFO as u8), 7), Some("drawn"));
        assert_eq!(option_name(ChoiceId(13), 5), Some("form"));
        assert_eq!(option_name(ChoiceId(osc_choice(2, C_WARP + 1) as u8), 8), Some("fm"));
        assert_eq!(option_name(ChoiceId(osc_choice(1, C_FX) as u8), 1), Some("chorus"));
    }

    #[test]
    fn a_step_is_the_nearest_option_to_the_clamped_sum() {
        // Nine warp modes: `off` (0) + 1 is `fm` (8); `fold` (4) − 0.25 is
        // `sync` (2); a sixteenth either way of an option stays on it.
        assert_eq!(step(0, 9, 1.0), 8);
        assert_eq!(step(4, 9, -0.25), 2);
        assert_eq!(step(4, 9, 0.06), 4);
        assert_eq!(step(4, 9, -0.06), 4);
        assert_eq!(step(4, 9, 3.0), 8, "clamped");
        assert_eq!(step(4, 9, -3.0), 0);
        // Halfway between two options goes up, as the kit rounds.
        assert_eq!(step(0, 3, 0.25), 1);
        assert_eq!(step(0, 1, 0.9), 0);
    }

    #[test]
    fn the_bank_is_the_built_ins_then_each_other_table_once() {
        let t = |a: &str, b: &str, c: &str| [a.to_string(), b.to_string(), c.to_string()];
        let (bank, len, own) = table_bank(&t("Glass Organ", "Mine", "Mine"));
        assert_eq!(len, 6);
        assert_eq!(bank[5], BankEntry::Osc(1));
        assert_eq!(own, [1, 5, 5]);
        assert_eq!(bank_names(&t("Glass Organ", "Mine", "Other")), ["Formant Sweep", "Glass Organ", "Vowel Ah–Oo", "Hollow Pulse", "Grit Saw", "Mine", "Other"]);
        assert_eq!(table_bank(&t("Grit Saw", "Grit Saw", "Formant Sweep")).1, 5);
    }
}
