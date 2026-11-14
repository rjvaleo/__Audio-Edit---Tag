//! A small JSON writer, so the crate needs nothing but audio-core.

pub enum J {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub fn obj() -> J {
        J::Obj(Vec::new())
    }
    pub fn set(mut self, k: &str, v: impl Into<J>) -> J {
        if let J::Obj(ref mut m) = self {
            m.push((k.to_string(), v.into()));
        }
        self
    }
    /// A number rounded to `d` decimals.
    pub fn r(x: f32, d: i32) -> J {
        if !x.is_finite() {
            return J::Null;
        }
        let p = 10f64.powi(d);
        J::Num((x as f64 * p).round() / p)
    }
    pub fn write(&self, out: &mut String, depth: usize) {
        match self {
            J::Null => out.push_str("null"),
            J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            J::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    out.push_str(&format!("{}", *n as i64));
                } else {
                    out.push_str(&format!("{n}"));
                }
            }
            J::Str(s) => {
                out.push('"');
                for c in s.chars() {
                    match c {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            J::Arr(v) => {
                // Arrays of plain values stay on one line; nested ones go one per line.
                let flat = v.iter().all(|x| !matches!(x, J::Arr(_) | J::Obj(_)));
                out.push('[');
                for (i, x) in v.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    if !flat {
                        out.push('\n');
                        out.push_str(&"  ".repeat(depth + 1));
                    }
                    x.write(out, depth + 1);
                }
                if !flat && !v.is_empty() {
                    out.push('\n');
                    out.push_str(&"  ".repeat(depth));
                }
                out.push(']');
            }
            J::Obj(m) => {
                out.push('{');
                for (i, (k, v)) in m.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push('\n');
                    out.push_str(&"  ".repeat(depth + 1));
                    J::Str(k.clone()).write(out, 0);
                    out.push_str(": ");
                    v.write(out, depth + 1);
                }
                if !m.is_empty() {
                    out.push('\n');
                    out.push_str(&"  ".repeat(depth));
                }
                out.push('}');
            }
        }
    }
    pub fn to_string_pretty(&self) -> String {
        let mut s = String::new();
        self.write(&mut s, 0);
        s.push('\n');
        s
    }
}

impl From<f64> for J {
    fn from(x: f64) -> J {
        J::Num(x)
    }
}
impl From<usize> for J {
    fn from(x: usize) -> J {
        J::Num(x as f64)
    }
}
impl From<bool> for J {
    fn from(x: bool) -> J {
        J::Bool(x)
    }
}
impl From<&str> for J {
    fn from(x: &str) -> J {
        J::Str(x.to_string())
    }
}
impl From<String> for J {
    fn from(x: String) -> J {
        J::Str(x)
    }
}
impl From<Vec<J>> for J {
    fn from(x: Vec<J>) -> J {
        J::Arr(x)
    }
}
