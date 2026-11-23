//! The page's hand edits of the cuts (`ui/app/400-chop-cut.js`): moving an
//! edge (`chopMoveEdge`), taking a cut out (`chopDeleteCut`), the pencil
//! (`chopAddCut`, with `chopSnap`, `chopMinGap`, `chopContig`), the lock
//! tool, and picking (`chopPick`, `chopPicked`, `chopToggle`). Line for line;
//! what the page does after (`chopChanged`: the measures, the pictures) is
//! the caller's.

use super::{js, Mode, Page, Slice};

/// A slice's switch, as `chopToggle` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flag {
    Rev,
    Muted,
    Locked,
    Moved,
}

impl Flag {
    /// By the page's name: `rev`, `muted`, `locked`, `moved`.
    pub fn named(name: &str) -> Option<Flag> {
        Some(match name {
            "rev" => Flag::Rev,
            "muted" => Flag::Muted,
            "locked" => Flag::Locked,
            "moved" => Flag::Moved,
            _ => return None,
        })
    }

    pub fn of(self, x: &Slice) -> bool {
        match self {
            Flag::Rev => x.rev,
            Flag::Muted => x.muted,
            Flag::Locked => x.locked,
            Flag::Moved => x.moved,
        }
    }

    pub fn set(self, x: &mut Slice, on: bool) {
        match self {
            Flag::Rev => x.rev = on,
            Flag::Muted => x.muted = on,
            Flag::Locked => x.locked = on,
            Flag::Moved => x.moved = on,
        }
    }
}

impl Page {
    /// `chopContig`: slices touch, except between the silences.
    pub fn contig(&self) -> bool {
        self.settings.mode != Mode::Silence
    }

    /// `chopMinGap`: the least a slice can be, 5 ms or 16 frames.
    pub fn min_gap(&self) -> i64 {
        js::max(16.0, js::round(self.rate * 0.005)) as i64
    }

    /// `chopSnap(at)`: its reach, 2 ms.
    pub fn snap_near(&self, at: i64) -> i64 {
        self.snap(at, js::round(self.rate * 0.002) as i64)
    }

    /// `chopMoveEdge(i, side, to)`: the start (`start` true) or end of slice
    /// `i`. Between two slices that touch, the edge is both.
    pub fn move_edge(&mut self, i: usize, start: bool, to: i64) {
        if i >= self.slices.len() {
            return;
        }
        let g = self.min_gap();
        let (s0, e0) = self.region;
        let contig = self.contig();
        let n = self.slices.len();
        if start {
            let lo = if i > 0 { self.slices[i - 1].s + g } else { s0 };
            let hi = self.slices[i].e - g;
            let s = lo.max(hi.min(to));
            self.slices[i].s = s;
            if i > 0 && (contig || self.slices[i - 1].e > s) {
                self.slices[i - 1].e = s;
            }
        } else {
            let lo = self.slices[i].s + g;
            let hi = if i + 1 < n {
                if contig {
                    self.slices[i + 1].e - g
                } else {
                    self.slices[i + 1].s
                }
            } else {
                e0
            };
            let e = lo.max(hi.min(to));
            self.slices[i].e = e;
            if contig && i + 1 < n {
                self.slices[i + 1].s = e;
            }
        }
        self.slices[i].moved = true;
        if contig && !start && i + 1 < n {
            self.slices[i + 1].moved = true;
        }
    }

    /// `chopDeleteCut(i)`: between slices that touch, slice `i` joins the
    /// one before; otherwise it goes. Nothing is picked after. False when
    /// there is no slice `i`.
    pub fn delete_cut(&mut self, i: usize) -> bool {
        if i >= self.slices.len() {
            return false;
        }
        if self.contig() && i > 0 {
            self.slices[i - 1].e = self.slices[i].e;
        }
        self.slices.remove(i);
        self.sel.clear();
        self.current = -1;
        true
    }

    /// `chopAddCut(at)`, the pencil: inside a slice it splits it; in a gap
    /// it starts a slice running to the next, or 100 ms. True when the page
    /// would call `chopChanged` (a cut was made).
    pub fn add_cut(&mut self, at: i64) -> bool {
        let (s0, e0) = self.region;
        if at <= s0 || at >= e0 {
            return false;
        }
        let at = self.snap_near(at);
        let g = self.min_gap();
        if let Some(i) = self.slices.iter().position(|x| at > x.s && at < x.e) {
            let x = self.slices[i];
            if at - x.s < g || x.e - at < g {
                return false;
            }
            self.slices.insert(i + 1, Slice { s: at, e: x.e, moved: true, muted: x.muted, rev: x.rev, locked: false });
            self.slices[i].e = at;
        } else {
            let contig = self.contig();
            if contig && self.slices.is_empty() {
                self.slices.push(Slice { s: s0, e: e0, ..Slice::default() });
            }
            let e = match self.slices.iter().find(|x| x.s > at) {
                Some(next) => next.s,
                None => e0.min(at + js::round(self.rate * 0.1) as i64),
            };
            if e - at < g {
                return false;
            }
            self.slices.push(Slice { s: at, e, moved: true, ..Slice::default() });
            self.slices.sort_by_key(|x| x.s);
            if contig {
                for j in 1..self.slices.len() {
                    self.slices[j - 1].e = self.slices[j].s;
                }
            }
        }
        true
    }

    /// The lock tool on slice `i`: its cut locked, or not.
    pub fn toggle_lock(&mut self, i: usize) -> bool {
        match self.slices.get_mut(i) {
            Some(x) => {
                x.locked = !x.locked;
                true
            }
            None => false,
        }
    }

    /// `chopPick(i, { add })`: `add` toggles `i` in the picked set; else it is
    /// the only one picked (-1: none). Either way it is the current one.
    pub fn pick(&mut self, i: i64, add: bool) {
        if add {
            match self.sel.iter().position(|&k| k == i) {
                Some(at) => {
                    self.sel.remove(at);
                }
                None => self.sel.push(i),
            }
        } else {
            self.sel = if i >= 0 { vec![i] } else { Vec::new() };
        }
        self.current = i;
    }

    /// `chopPicked`: the slices picked, or the current one when none are.
    pub fn picked(&self) -> Vec<i64> {
        if !self.sel.is_empty() {
            self.sel.clone()
        } else if self.current >= 0 {
            vec![self.current]
        } else {
            Vec::new()
        }
    }

    /// `chopToggle(flag)` on the picked: on unless every one is on already.
    /// False when nothing is picked (the page says "Pick a slice first").
    pub fn toggle(&mut self, flag: Flag) -> bool {
        let which = self.picked();
        if which.is_empty() {
            return false;
        }
        let get = |p: &Page, i: i64| usize::try_from(i).ok().and_then(|i| p.slices.get(i)).is_some_and(|x| flag.of(x));
        let on = !which.iter().all(|&i| get(self, i));
        for i in which {
            if let Some(x) = usize::try_from(i).ok().and_then(|i| self.slices.get_mut(i)) {
                flag.set(x, on);
            }
        }
        true
    }

    /// `Chop.setRegion(s, e)`: S and E, then cut again.
    pub fn set_region(&mut self, s: i64, e: i64) {
        self.region = (s, e);
        self.recut();
    }
}
