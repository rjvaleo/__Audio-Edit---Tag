//! What Detect and ½× / 2× say, and the Bars and Beats they set
//! (`ui/app/402-chop-listen.js`: `chopDetect`, `chopScaleBars`). The page
//! then sets those in both slots, A and B (`chopSetBars`), and cuts again;
//! the slots are the caller's.

use super::{js, Tempo};

/// `chopDetect`: the words for Time's header (`chopTempoSaid`), and the
/// Bars and Beats to set; none when there is no clear beat (Bars is left
/// alone).
pub fn detect_said(r: Option<&Tempo>) -> (String, Option<(f64, f64)>) {
    let Some(r) = r.filter(|r| r.sure >= 0.12) else { return ("no clear beat".into(), None) };
    let beats = if r.beats != 0.0 && !r.beats.is_nan() { format!(" + {}", js::num(r.beats)) } else { String::new() };
    let count = format!("{} bar{}{}", js::num(r.bars), if r.bars == 1.0 { "" } else { "s" }, beats);
    let mut text = if r.whole {
        format!("{count}, loops even")
    } else {
        format!("heard {} · {} ms {} {count}", js::fixed(r.heard, 1), js::fixed(r.off.abs(), 0), if r.off > 0.0 { "short of" } else { "over" })
    };
    if r.sure < 0.35 {
        text += " (a guess)";
    }
    (text, Some((r.bars, r.beats)))
}

/// `chopScaleBars(f)` from Bars, Beats and the signature now: the words,
/// and the new Bars and Beats.
pub fn scale_bars(bars: f64, beats: f64, sig: f64, f: f64) -> (String, f64, f64) {
    let total = js::max(1.0, js::round((bars * sig + beats) * f));
    let b = (total / sig).floor();
    let shown = js::max(1.0, b);
    let rest = total % sig;
    let more = if b != 0.0 && rest != 0.0 && !rest.is_nan() { format!(" + {}", js::num(rest)) } else { String::new() };
    let text = format!("{} bar{}{}, by hand", js::num(shown), if shown == 1.0 { "" } else { "s" }, more);
    (text, shown, if b != 0.0 { rest } else { 0.0 })
}
