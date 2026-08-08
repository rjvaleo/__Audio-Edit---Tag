//! Filename text matching.
//!
//! The Python classifier this replaces used around sixty regular expressions,
//! nearly all of them word-boundary alternations like `\b(kick|kik|bd)\b`.
//! Normalising once and testing set membership does the same job without a
//! regex engine, which keeps the build dependency-free, and is markedly faster
//! because the normalisation is shared across every rule instead of each
//! pattern rescanning the string.

/// A filename (plus its enclosing folder names) prepared for matching.
pub struct Text {
    /// Lowercased, separators collapsed to single spaces, padded with spaces at
    /// both ends so phrase lookups can rely on word boundaries.
    padded: String,
    tokens: Vec<String>,
}

impl Text {
    pub fn new(raw: &str) -> Self {
        let mut norm = String::with_capacity(raw.len() + 2);
        let mut last_space = true;
        for ch in raw.chars() {
            if ch.is_ascii_alphanumeric() {
                norm.push(ch.to_ascii_lowercase());
                last_space = false;
            } else if !last_space {
                norm.push(' ');
                last_space = true;
            }
        }
        let tokens: Vec<String> = norm.split_whitespace().map(|s| s.to_string()).collect();
        Self {
            padded: format!(" {} ", norm.trim()),
            tokens,
        }
    }

    /// Join several strings (folder chain plus filename) into one searchable text.
    pub fn from_parts(parts: &[&str]) -> Self {
        Self::new(&parts.join(" "))
    }

    pub fn tokens(&self) -> &[String] {
        &self.tokens
    }

    /// Is `word` present as a whole token?
    pub fn has(&self, word: &str) -> bool {
        self.tokens.iter().any(|t| t == word)
    }

    /// Is any of `words` present as a whole token?
    pub fn has_any(&self, words: &[&str]) -> bool {
        words.iter().any(|w| self.has(w))
    }

    /// Is `phrase` present as a run of whole tokens? `phrase` must already be
    /// lowercase and space-separated.
    pub fn has_phrase(&self, phrase: &str) -> bool {
        self.padded.contains(&format!(" {phrase} "))
    }

    /// Matches `prefix` immediately followed by `digits`, with or without a
    /// separator between them — so "tr808", "tr-808" and "tr 808" all hit.
    pub fn has_model(&self, prefix: &str, digits: &str) -> bool {
        let joined = format!("{prefix}{digits}");
        self.has(&joined) || self.has_phrase(&format!("{prefix} {digits}"))
    }

    /// A bare number used as a model name, e.g. "808" in "808 kick".
    /// Only matches when the number stands alone as its own token.
    pub fn has_bare_number(&self, digits: &str) -> bool {
        self.has(digits)
    }

    /// Extract a tempo written as "120bpm", "120 bpm" or "bpm 120".
    pub fn bpm(&self) -> Option<u32> {
        for (i, t) in self.tokens.iter().enumerate() {
            // With no separator the whole thing is one token: "120bpm", but
            // also "groove128bpm". Take the digits immediately before "bpm"
            // rather than assuming they are the entire token.
            if let Some(head) = t.strip_suffix("bpm") {
                let digits: String = head
                    .chars()
                    .rev()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                if let Ok(v) = digits.parse::<u32>() {
                    if (20..=400).contains(&v) {
                        return Some(v);
                    }
                }
            }
            if t == "bpm" {
                for cand in [i.checked_sub(1).map(|j| &self.tokens[j]), self.tokens.get(i + 1)]
                    .into_iter()
                    .flatten()
                {
                    if let Ok(v) = cand.parse::<u32>() {
                        if (20..=400).contains(&v) {
                            return Some(v);
                        }
                    }
                }
            }
        }
        None
    }
}

/// Split a filename stem into a base name and a trailing number, so that
/// "chop 07" and "chop 08" are recognised as members of one series.
///
/// Returns `None` when there is no trailing number.
pub fn series_parts(stem: &str) -> Option<(String, u32)> {
    let trimmed = stem.trim_end();
    let digits: String = trimmed
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if digits.is_empty() || digits.len() > 4 {
        return None;
    }
    let base = &trimmed[..trimmed.len() - digits.len()];
    let root = base.trim_end_matches([' ', '_', '-', '.', '#']);
    let index = digits.parse::<u32>().ok()?;
    Some((root.trim().to_lowercase(), index))
}

/// Lowercase, hyphen-separated form used for tag keywords.
pub fn slug(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = true;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}
