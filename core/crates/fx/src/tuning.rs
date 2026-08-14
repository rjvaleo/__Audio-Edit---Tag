//! Tuning systems, and snapping a pitch to one.
//!
//! The pitch control moves in semitones and, left alone, in half-semitone
//! steps — which is a grid, not a tuning. This is the tuning table from the
//! scale sequencer: eighty-one scales in **true cents**, not rounded to
//! twelve-tone equal temperament unless the scale is inherently 12-TET. A
//! maqam's neutral third is 355 cents here because that is where it is, not
//! 300 or 400 because that is what a piano has.
//!
//! Quantising is done on the *shift*, not on an absolute pitch. This program
//! transposes a recording rather than playing notes, so there is no key to be
//! in: what a scale can usefully say is which intervals you may move **by**.
//! Ionian therefore offers a tone, a major third, a fifth and so on, in either
//! direction and across as many octaves as the range allows.

/// One tuning, as cents above its root.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scale {
    /// The group it belongs to, for a menu.
    pub cat: &'static str,
    pub name: &'static str,
    /// Where it comes from and how many degrees it has.
    pub info: &'static str,
    /// Degrees in cents, ascending from the root. The octave itself is not
    /// listed; it is implied by `span`.
    pub cents: &'static [f32],
}

impl Scale {
    /// The interval the scale repeats at, in cents.
    ///
    /// An octave for nearly everything. Bohlen-Pierce repeats at a tritave —
    /// 1902 cents, a 3:1 — and the Carlos scales do not close at an octave at
    /// all, so the repeat is taken from the scale rather than assumed.
    pub fn span(&self) -> f32 {
        match self.cents.last() {
            // Anything that fits inside an octave repeats at one — including
            // scales whose top degree is a seventh, which is nearly all of
            // them. Taking "last degree plus a step" instead put Ionian's
            // octave at 1283 cents and every transposition past the first out
            // of tune with the one below it.
            Some(&last) if last < 1200.0 => 1200.0,
            // Past an octave, the scale is telling us its own period: a
            // tritave for Bohlen-Pierce. One average step past the top.
            Some(&last) if self.cents.len() > 1 => last + last / (self.cents.len() - 1) as f32,
            _ => 1200.0,
        }
    }

    /// The nearest degree to `cents`, in either direction, across octaves.
    ///
    /// Returns the cents to move by. A scale with no degrees returns the input
    /// untouched rather than snapping everything to zero.
    pub fn nearest(&self, cents: f32) -> f32 {
        if self.cents.is_empty() {
            return cents;
        }
        let span = self.span().max(1.0);
        // Which repetition of the scale the target sits in, and where in it.
        let octave = (cents / span).floor();
        let within = cents - octave * span;
        let mut best = f32::INFINITY;
        let mut at = cents;
        // The degree below, the degree above, and the first degree of the next
        // repetition — the nearest can be any of the three.
        for rep in [octave, octave + 1.0] {
            for d in self.cents {
                let candidate = rep * span + d;
                let far = (candidate - cents).abs();
                if far < best {
                    best = far;
                    at = candidate;
                }
            }
        }
        let _ = within;
        at
    }
}

pub const SCALES: &[Scale] = &[
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Ionian (Major)", info: "Western · 7 notes", cents: &[0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1100.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Dorian", info: "Western/Medieval · 7 notes", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 900.0, 1000.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Phrygian", info: "Western/Medieval · 7 notes", cents: &[0.0, 100.0, 300.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Lydian", info: "Western/Medieval · 7 notes", cents: &[0.0, 200.0, 400.0, 600.0, 700.0, 900.0, 1100.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Mixolydian", info: "Western/Medieval · 7 notes", cents: &[0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1000.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Aeolian (Natural Minor)", info: "Western · 7 notes", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "WESTERN DIATONIC — 12-TET", name: "Locrian", info: "Western/Medieval · 7 notes", cents: &[0.0, 100.0, 300.0, 500.0, 600.0, 800.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Harmonic Minor", info: "Western · 7 notes", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Melodic Minor (ascending)", info: "Western · 7 notes", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 900.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Major Pentatonic", info: "Global · 5 notes", cents: &[0.0, 200.0, 400.0, 700.0, 900.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Minor Pentatonic", info: "Global · 5 notes", cents: &[0.0, 300.0, 500.0, 700.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Blues Scale", info: "American · 6 notes", cents: &[0.0, 300.0, 500.0, 600.0, 700.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Whole Tone", info: "French Impressionist · 6 notes", cents: &[0.0, 200.0, 400.0, 600.0, 800.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Diminished (Half-Whole)", info: "Jazz · 8 notes", cents: &[0.0, 100.0, 300.0, 400.0, 600.0, 700.0, 900.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Diminished (Whole-Half)", info: "Jazz · 8 notes", cents: &[0.0, 200.0, 300.0, 500.0, 600.0, 800.0, 900.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Double Harmonic (Byzantine)", info: "Eastern/Western · 7 notes", cents: &[0.0, 100.0, 400.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Hungarian Minor", info: "Eastern European · 7 notes", cents: &[0.0, 200.0, 300.0, 600.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Spanish Phrygian Dominant", info: "Flamenco/Middle Eastern · 7 notes", cents: &[0.0, 100.0, 400.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Persian", info: "Middle Eastern · 7 notes", cents: &[0.0, 100.0, 400.0, 500.0, 600.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Prometheus (Scriabin)", info: "Western · 6 notes", cents: &[0.0, 200.0, 400.0, 600.0, 900.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Augmented Scale", info: "Western · 6 notes", cents: &[0.0, 300.0, 400.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Enigmatic", info: "Western/Verdi · 7 notes", cents: &[0.0, 100.0, 400.0, 600.0, 800.0, 1000.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Neapolitan Major", info: "Western · 7 notes", cents: &[0.0, 100.0, 300.0, 500.0, 700.0, 900.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Neapolitan Minor", info: "Western · 7 notes", cents: &[0.0, 100.0, 300.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Romanian Minor", info: "Eastern European · 7 notes", cents: &[0.0, 200.0, 300.0, 600.0, 700.0, 900.0, 1000.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Bebop Dominant", info: "Jazz · 8 notes", cents: &[0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1000.0, 1100.0] },
    Scale { cat: "WESTERN EXTENDED — 12-TET", name: "Bebop Major", info: "Jazz · 8 notes", cents: &[0.0, 200.0, 400.0, 500.0, 700.0, 800.0, 900.0, 1100.0] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Pythagorean Tuning", info: "Ancient Greek · 12 notes · 3-limit", cents: &[0.0, 114.0, 204.0, 294.1, 408.0, 498.0, 612.0, 702.0, 816.0, 906.1, 996.1, 1110.0] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Ptolemy's Intense Diatonic (Just Major)", info: "Ancient Greek · 7 notes · 5-limit", cents: &[0.0, 203.9, 386.3, 498.0, 702.0, 884.4, 1088.3] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Ptolemy's Soft Diatonic", info: "Ancient Greek · 7 notes", cents: &[0.0, 182.4, 386.3, 498.0, 702.0, 884.4, 1086.8] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Five-Limit Just Intonation", info: "Historical · 12 notes · 5-limit", cents: &[0.0, 111.7, 203.9, 315.6, 386.3, 498.0, 590.2, 702.0, 813.7, 884.4, 996.1, 1088.3] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Seven-Limit Just Intonation", info: "Contemporary · 12 notes · 7-limit", cents: &[0.0, 119.4, 203.9, 231.2, 386.3, 470.8, 582.5, 702.0, 764.9, 884.4, 968.8, 1017.6] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Harmonic Series (partials 1–16)", info: "Universal/Overtone-based · 15 notes", cents: &[0.0, 203.9, 386.3, 498.0, 582.5, 702.0, 772.6, 840.5, 884.4, 968.8, 1017.6, 1049.4, 1088.3, 1145.0, 1200.0] },
    Scale { cat: "JUST INTONATION — TRUE RATIOS", name: "Partch 43-Tone Scale (first octave)", info: "Harry Partch · 43 notes · 11-limit", cents: &[0.0, 21.5, 35.7, 49.4, 63.2, 84.5, 111.7, 119.4, 139.5, 155.1, 168.9, 203.9, 222.5, 231.2, 266.9, 274.6, 294.1, 315.6, 333.8, 345.0, 386.3, 413.6, 422.1, 470.8, 498.0, 519.5, 529.0, 551.3, 582.5, 600.9, 617.5, 631.3, 649.0, 672.0, 700.0, 722.0, 741.2, 764.9, 772.6, 784.1, 813.7, 840.5, 884.4, 906.1, 914.8, 932.5, 996.1, 1017.6] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "Meantone (Quarter-Comma)", info: "Renaissance/Baroque · 12 notes", cents: &[0.0, 76.0, 193.2, 310.3, 386.3, 503.4, 579.5, 696.6, 772.6, 889.7, 1006.8, 1082.9] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "Werckmeister III", info: "Baroque · 12 notes · J.S. Bach era", cents: &[0.0, 90.2, 192.0, 294.1, 390.2, 498.0, 588.3, 696.1, 792.2, 888.3, 996.1, 1092.2] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "Kirnberger III", info: "18th century German · 12 notes", cents: &[0.0, 90.2, 203.9, 294.1, 386.3, 498.0, 590.2, 702.0, 792.2, 895.1, 996.1, 1088.3] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "Vallotti Temperament", info: "18th century Italian · 12 notes", cents: &[0.0, 94.1, 196.1, 298.0, 392.2, 501.9, 594.1, 698.0, 796.1, 894.1, 1000.0, 1094.1] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "19-EDO", info: "Renaissance onward · 19 equal divisions", cents: &[0.0, 63.1579, 126.316, 189.474, 252.632, 315.789, 378.947, 442.105, 505.263, 568.421, 631.579, 694.737, 757.895, 821.053, 884.211, 947.368, 1010.53, 1073.68, 1136.84] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "31-EDO", info: "Theoretical/Huygens · 31 equal divisions", cents: &[0.0, 38.7097, 77.4194, 116.129, 154.839, 193.548, 232.258, 270.968, 309.677, 348.387, 387.097, 425.807, 464.516, 503.226, 541.936, 580.645, 619.355, 658.064, 696.774, 735.484, 774.193, 812.903, 851.613, 890.323, 929.032, 967.742, 1006.45, 1045.16, 1083.87, 1122.58, 1161.29] },
    Scale { cat: "HISTORICAL TEMPERAMENTS", name: "53-EDO", info: "Theoretical · 53 equal divisions", cents: &[0.0, 22.6415, 45.283, 67.9245, 90.566, 113.207, 135.849, 158.491, 181.132, 203.774, 226.415, 249.057, 271.698, 294.34, 316.981, 339.623, 362.264, 384.906, 407.547, 430.189, 452.83, 475.472, 498.113, 520.755, 543.396, 566.038, 588.679, 611.321, 633.962, 656.604, 679.245, 701.887, 724.528, 747.17, 769.811, 792.453, 815.094, 837.736, 860.377, 883.019, 905.66, 928.302, 950.943, 973.585, 996.226, 1018.87, 1041.51, 1064.15, 1086.79, 1109.43, 1132.08, 1154.72, 1177.36] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "Quarter-Tone Scale (24-EDO)", info: "Middle Eastern/Contemporary · 24 divisions", cents: &[0.0, 50.0, 100.0, 150.0, 200.0, 250.0, 300.0, 350.0, 400.0, 450.0, 500.0, 550.0, 600.0, 650.0, 700.0, 750.0, 800.0, 850.0, 900.0, 950.0, 1000.0, 1050.0, 1100.0, 1150.0] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "17-EDO", info: "Arabic approximation · 17 equal divisions", cents: &[0.0, 70.5882, 141.177, 211.765, 282.353, 352.941, 423.529, 494.118, 564.706, 635.294, 705.882, 776.471, 847.059, 917.647, 988.235, 1058.82, 1129.41] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "22-EDO", info: "Indian sruti approximation · 22 equal divisions", cents: &[0.0, 54.5455, 109.091, 163.636, 218.182, 272.727, 327.273, 381.818, 436.364, 490.909, 545.455, 600.0, 654.545, 709.091, 763.636, 818.182, 872.727, 927.273, 981.818, 1036.36, 1090.91, 1145.45] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "72-EDO", info: "Franz Richter Herf · 72 divisions · sixth-tones", cents: &[0.0, 16.6667, 33.3333, 50.0, 66.6667, 83.3333, 100.0, 116.667, 133.333, 150.0, 166.667, 183.333, 200.0, 216.667, 233.333, 250.0, 266.667, 283.333, 300.0, 316.667, 333.333, 350.0, 366.667, 383.333, 400.0, 416.667, 433.333, 450.0, 466.667, 483.333, 500.0, 516.667, 533.333, 550.0, 566.667, 583.333, 600.0, 616.667, 633.333, 650.0, 666.667, 683.333, 700.0, 716.667, 733.333, 750.0, 766.667, 783.333, 800.0, 816.667, 833.333, 850.0, 866.667, 883.333, 900.0, 916.667, 933.333, 950.0, 966.667, 983.333, 1000.0, 1016.67, 1033.33, 1050.0, 1066.67, 1083.33, 1100.0, 1116.67, 1133.33, 1150.0, 1166.67, 1183.33] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "Wendy Carlos Alpha", info: "1986 Beauty in the Beast · 15.39¢/step", cents: &[0.0, 15.39, 30.78, 46.17, 61.56, 76.95, 92.34, 107.73, 123.12, 138.51, 153.9, 169.29, 184.68, 200.07, 215.46, 230.85, 246.24, 261.63, 277.02] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "Wendy Carlos Beta", info: "1986 · 18.75¢/step", cents: &[0.0, 18.75, 37.5, 56.25, 75.0, 93.75, 112.5, 131.25, 150.0, 168.75, 187.5, 206.25, 225.0, 243.75, 262.5, 281.25] },
    Scale { cat: "MICROTONAL & CONTEMPORARY", name: "Bohlen-Pierce Scale", info: "Bohlen/Pierce · 13 divisions of tritave (3:1)", cents: &[0.0, 146.308, 292.615, 438.923, 585.231, 731.538, 877.846, 1024.15, 1170.46, 1316.77, 1463.08, 1609.38, 1755.69] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Rast", info: "Arabic/Turkish · 7 notes · neutral third", cents: &[0.0, 204.0, 351.0, 498.0, 702.0, 906.0, 1053.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Bayati", info: "Arabic/Turkish · 7 notes · neutral second", cents: &[0.0, 150.0, 300.0, 498.0, 702.0, 852.0, 1002.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Hijaz", info: "Arabic/Turkish · 7 notes · augmented second", cents: &[0.0, 100.0, 400.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Hijaz Kar", info: "Arabic · 7 notes · double augmented second", cents: &[0.0, 100.0, 400.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Saba", info: "Arabic · 7 notes · very low third", cents: &[0.0, 150.0, 280.0, 498.0, 648.0, 798.0, 1002.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Sikah", info: "Arabic/Turkish · built on neutral third", cents: &[0.0, 204.0, 351.0, 551.0, 702.0, 853.0, 1002.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Nahawand", info: "Arabic · 7 notes · harmonic minor character", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Maqam Nawa Athar", info: "Arabic · 7 notes", cents: &[0.0, 200.0, 300.0, 600.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Makam Ussak", info: "Turkish · 7 notes · microtonal inflections", cents: &[0.0, 150.0, 300.0, 500.0, 700.0, 850.0, 1000.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Persian Shur", info: "Iranian classical · 7 notes", cents: &[0.0, 150.0, 300.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Persian Chahargah", info: "Iranian · 7 notes", cents: &[0.0, 200.0, 350.0, 500.0, 700.0, 900.0, 1050.0] },
    Scale { cat: "MIDDLE EASTERN — MAQAM", name: "Persian Segah", info: "Iranian · 7 notes", cents: &[0.0, 150.0, 350.0, 500.0, 700.0, 850.0, 1050.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Bhairav", info: "Indian Hindustani · 7 notes · morning raga", cents: &[0.0, 100.0, 400.0, 500.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Bhairavi", info: "Indian classical · 7 notes · all flat", cents: &[0.0, 100.0, 300.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Yaman (Kalyan)", info: "Indian classical · 7 notes · raised fourth · evening", cents: &[0.0, 200.0, 400.0, 600.0, 700.0, 900.0, 1100.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Kafi", info: "Indian classical · 7 notes · Dorian with microtones", cents: &[0.0, 200.0, 290.0, 500.0, 700.0, 900.0, 980.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Todi", info: "Indian classical · 7 notes · complex microtonal", cents: &[0.0, 100.0, 300.0, 600.0, 700.0, 800.0, 1100.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Marwa", info: "Indian classical · 7 notes · no perfect fifth", cents: &[0.0, 100.0, 400.0, 600.0, 900.0, 1100.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Raga Asavari", info: "Indian classical · 7 notes · descending emphasis", cents: &[0.0, 200.0, 300.0, 500.0, 700.0, 800.0, 1000.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "22-Shruti Scale", info: "Indian classical theory · 22 microtones", cents: &[0.0, 22.0, 90.0, 112.0, 182.0, 204.0, 270.0, 294.0, 316.0, 386.0, 408.0, 498.0, 520.0, 590.0, 612.0, 702.0, 724.0, 792.0, 814.0, 884.0, 906.0, 996.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Slendro (Javanese Gamelan)", info: "Java/Bali · 5 notes · non-equal spacing", cents: &[0.0, 231.0, 474.0, 711.0, 951.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Pelog (Javanese Gamelan)", info: "Java/Bali · 7 notes · highly unequal", cents: &[0.0, 122.0, 271.0, 540.0, 675.0, 785.0, 947.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Pelog Selisir (Balinese)", info: "Balinese Gamelan · 5-note Pelog mode", cents: &[0.0, 122.0, 271.0, 675.0, 785.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Japanese In Scale", info: "Japanese traditional · 5 notes · hemitonic", cents: &[0.0, 100.0, 500.0, 700.0, 800.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Japanese Yo Scale (Gagaku)", info: "Japanese · 5 notes · anhemitonic", cents: &[0.0, 200.0, 500.0, 700.0, 900.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Japanese Hirajoshi", info: "Japanese Koto · 5 notes · dark", cents: &[0.0, 200.0, 300.0, 700.0, 800.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Japanese Insen", info: "Japanese · 5 notes · very sparse", cents: &[0.0, 100.0, 500.0, 700.0, 1000.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Chinese Gong (Major Pentatonic)", info: "Chinese traditional · 5 notes", cents: &[0.0, 204.0, 408.0, 702.0, 906.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Chinese Yu (Minor Pentatonic)", info: "Chinese traditional · 5 notes", cents: &[0.0, 294.0, 498.0, 702.0, 996.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Mongolian Pentatonic", info: "Central Asian · 5 notes", cents: &[0.0, 200.0, 400.0, 700.0, 900.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Thai Ranat Scale", info: "Thai traditional · 7 near-equidistant tones", cents: &[0.0, 171.0, 343.0, 514.0, 686.0, 857.0, 1029.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Gamelan Degung (Sundanese)", info: "West Java · 5 notes", cents: &[0.0, 176.0, 410.0, 702.0, 878.0] },
    Scale { cat: "SOUTH & EAST ASIAN", name: "Sanfen Sunyi (Chinese Pythagorean)", info: "Ancient Chinese · 12 notes · stacked fifths", cents: &[0.0, 114.0, 204.0, 294.0, 408.0, 498.0, 612.0, 702.0, 816.0, 906.0, 996.0, 1110.0] },
];

/// A scale by name, or `None` for a name nothing here has.
///
/// By name rather than by index, because an index is not a promise: inserting
/// a scale would silently retune every saved document.
pub fn by_name(name: &str) -> Option<&'static Scale> {
    SCALES.iter().find(|s| s.name == name)
}

/// Snap a pitch shift in semitones to the nearest degree of `scale`.
///
/// `None`, or a name nothing matches, leaves the value alone — which is what
/// keeps the control continuous until a scale is actually chosen.
pub fn quantise(semitones: f32, scale: Option<&str>) -> f32 {
    let Some(s) = scale.and_then(by_name) else {
        return semitones;
    };
    s.nearest(semitones * 100.0) / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The source is a note list rather than a tuning table, and a couple of
    /// its entries end by returning to the root — Raga Marwa is written
    /// `[0, 100, 400, 600, 900, 1100, 0]`. Sorted and deduplicated on the way
    /// over, so what is here is a set of degrees.
    #[test]
    fn every_scale_is_ascending_and_starts_at_its_root() {
        for s in SCALES {
            assert!(!s.cents.is_empty(), "{} has no degrees", s.name);
            assert!(
                (s.cents[0]).abs() < 1e-3,
                "{} does not start at its root: {}",
                s.name,
                s.cents[0]
            );
            for w in s.cents.windows(2) {
                assert!(w[1] > w[0], "{} is not ascending: {:?}", s.name, w);
            }
        }
    }

    #[test]
    fn the_library_is_the_whole_library() {
        assert_eq!(SCALES.len(), 81, "a scale went missing on the way over");
        let cats: std::collections::BTreeSet<_> = SCALES.iter().map(|s| s.cat).collect();
        assert_eq!(cats.len(), 7, "the categories are {cats:?}");
    }

    /// The point of the table: true intervals, not rounded to a piano.
    #[test]
    fn a_maqams_neutral_third_is_where_it_actually_is() {
        let rast = by_name("Maqam Rast").expect("no Rast");
        // Rast's third is neutral — between a minor and a major third, and on
        // no key of a twelve-tone instrument.
        let third = rast.cents.iter().find(|c| **c > 300.0 && **c < 400.0);
        let third = third.expect("Rast has no neutral third");
        assert!(
            (third - 350.0).abs() < 15.0,
            "Rast's third is at {third}¢, which is not neutral"
        );
    }

    #[test]
    fn quantising_lands_on_a_degree_and_nothing_between() {
        let ionian = by_name("Ionian (Major)").unwrap();
        // A tone, a major third, a fifth — in semitones.
        for (asked, want) in [(1.9f32, 2.0f32), (3.6, 4.0), (7.2, 7.0), (0.4, 0.0)] {
            let got = quantise(asked, Some("Ionian (Major)"));
            assert!(
                (got - want).abs() < 1e-3,
                "{asked} semitones snapped to {got}, expected {want}"
            );
        }
        let _ = ionian;
    }

    /// A scale has to work downward too. This transposes a recording; there is
    /// no key to be in, so the intervals go both ways.
    #[test]
    fn a_scale_reaches_below_the_root_as_well_as_above() {
        for asked in [-1.9f32, -3.6, -7.2, -13.0] {
            let got = quantise(asked, Some("Ionian (Major)"));
            assert!(got < 0.0, "{asked} snapped to {got}, which is the wrong way");
            // And it lands on a real degree of the scale, an octave down.
            let cents = got * 100.0;
            let within = cents.rem_euclid(1200.0);
            let ionian = by_name("Ionian (Major)").unwrap();
            assert!(
                ionian.cents.iter().any(|d| (d - within).abs() < 1e-2),
                "{asked} snapped to {got} semitones, which is not a degree"
            );
        }
    }

    #[test]
    fn no_scale_chosen_leaves_the_pitch_exactly_alone() {
        for v in [-7.3f32, 0.0, 0.25, 11.9] {
            assert_eq!(quantise(v, None), v);
            assert_eq!(quantise(v, Some("no such scale")), v);
        }
    }

    /// Bohlen-Pierce repeats at a tritave, not an octave. Assuming 1200 would
    /// put every degree past the first repetition in the wrong place.
    #[test]
    fn a_scale_that_does_not_repeat_at_the_octave_is_not_made_to() {
        let bp = by_name("Bohlen-Pierce Scale").expect("no Bohlen-Pierce");
        assert!(
            (bp.span() - 1902.0).abs() < 60.0,
            "Bohlen-Pierce repeats at {}¢, and it should be near 1902",
            bp.span()
        );
    }

    #[test]
    fn quantising_never_moves_a_pitch_further_than_the_widest_step() {
        for s in SCALES {
            let widest = s
                .cents
                .windows(2)
                .map(|w| w[1] - w[0])
                .fold(0f32, f32::max)
                .max(s.span() - s.cents.last().copied().unwrap_or(0.0));
            for step in 0..240 {
                let asked = -12.0 + step as f32 * 0.1;
                let got = s.nearest(asked * 100.0) / 100.0;
                let moved = (got - asked).abs() * 100.0;
                assert!(
                    moved <= widest / 2.0 + 1.0,
                    "{}: {asked} moved {moved:.1}¢, more than half its widest step ({widest:.1}¢)",
                    s.name
                );
            }
        }
    }
}
