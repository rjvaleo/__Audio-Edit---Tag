//! Atmosphere's browser-voice settings: `AT` of atmos.js, the knobs' raw
//! values, as the page reads them.

/// `atExp`: a 0–100 knob onto lo…hi, exponentially.
pub fn at_exp(v: f64, lo: f64, hi: f64) -> f64 {
    lo * (hi / lo).powf(v / 100.0)
}

/// The eight kinds of oscillator (`AT_KINDS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Classic,
    Supersaw,
    Spectrum,
    Choir,
    Glass,
    Breath,
    Cloud,
    Endless,
}

impl Kind {
    pub const ALL: [Kind; 8] = [Kind::Classic, Kind::Supersaw, Kind::Spectrum, Kind::Choir, Kind::Glass, Kind::Breath, Kind::Cloud, Kind::Endless];

    pub fn from_index(i: f64) -> Kind {
        Kind::ALL[(i.max(0.0) as usize).min(7)]
    }

    pub fn name(self) -> &'static str {
        ["classic", "supersaw", "spectrum", "choir", "glass", "breath", "cloud", "endless"][self as usize]
    }
}

/// One oscillator, A or B.
#[derive(Clone, Copy, Debug)]
pub struct Osc {
    pub kind: Kind,
    pub p1: f64,
    pub p2: f64,
    pub p3: f64,
    pub oct: f64,
}

/// Which notes Sympathy rings on (`symTune`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SymTune {
    Degrees,
    Fifths,
    Root,
}

/// `AT`: every value the browser voice, Character and Sympathy read.
#[derive(Clone, Debug)]
pub struct Patch {
    pub osc: [Osc; 2],
    pub blend: f64,
    pub unison: f64,
    pub detune: f64,
    pub width: f64,
    pub drift: f64,
    pub sub: f64,
    pub air: f64,
    pub glide: f64,
    pub atk: f64,
    pub dec: f64,
    pub sus: f64,
    pub rel: f64,
    pub vol: f64,
    pub flt_type: f64,
    pub flt_cut: f64,
    pub flt_res: f64,
    pub flt_key: f64,
    pub flt_amt: f64,
    pub flt_atk: f64,
    pub flt_dec: f64,
    pub flt_sus: f64,
    pub flt_rel: f64,
    // Character.
    pub ens: f64,
    pub ens_rate: f64,
    pub wow: f64,
    pub warm: f64,
    // Sympathy.
    pub sym: f64,
    pub sym_ring: f64,
    pub sym_mat: f64,
    pub sym_tune: SymTune,
    /// The scale, in cents above the root, and the root (its own tuning,
    /// which follows Seq's: Ionian on A 440 as the page starts).
    pub cents: [f64; 32],
    pub cents_len: usize,
    pub root_hz: f64,
}

impl Default for Patch {
    /// The page's starting values (`AT_KNOBS`, the selects' defaults).
    fn default() -> Self {
        let mut cents = [0.0; 32];
        let ionian = [0.0, 200.0, 400.0, 500.0, 700.0, 900.0, 1100.0];
        cents[..7].copy_from_slice(&ionian);
        Patch {
            osc: [
                Osc { kind: Kind::Choir, p1: 20.0, p2: 60.0, p3: 35.0, oct: 0.0 },
                Osc { kind: Kind::Spectrum, p1: 80.0, p2: 45.0, p3: 35.0, oct: 0.0 },
            ],
            blend: 40.0,
            unison: 5.0,
            detune: 18.0,
            width: 80.0,
            drift: 35.0,
            sub: 20.0,
            air: 20.0,
            glide: 20.0,
            atk: 74.0,
            dec: 70.0,
            sus: 80.0,
            rel: 78.0,
            vol: 70.0,
            flt_type: 0.0,
            flt_cut: 100.0,
            flt_res: 10.0,
            flt_key: 0.0,
            flt_amt: 0.0,
            flt_atk: 40.0,
            flt_dec: 60.0,
            flt_sus: 50.0,
            flt_rel: 70.0,
            ens: 40.0,
            ens_rate: 40.0,
            wow: 15.0,
            warm: 15.0,
            sym: 30.0,
            sym_ring: 55.0,
            sym_mat: 50.0,
            sym_tune: SymTune::Degrees,
            cents,
            cents_len: 7,
            root_hz: 440.0,
        }
    }
}

impl Patch {
    /// `atScale().cents`.
    pub fn scale(&self) -> &[f64] {
        &self.cents[..self.cents_len.max(1)]
    }

    /// The scale, from its cents (at most 32 degrees).
    pub fn set_scale(&mut self, cents: &[f64]) {
        let n = cents.len().min(32);
        self.cents[..n].copy_from_slice(&cents[..n]);
        self.cents_len = n.max(1);
        if n == 0 {
            self.cents[0] = 0.0;
        }
    }

    /// Set a value by the page's name for it (`atBlend`, `kindA`, …). False
    /// for a name it does not know.
    pub fn set(&mut self, key: &str, v: f64) -> bool {
        let slot: &mut f64 = match key {
            "kindA" => {
                self.osc[0].kind = Kind::from_index(v);
                return true;
            }
            "kindB" => {
                self.osc[1].kind = Kind::from_index(v);
                return true;
            }
            "symTune" => {
                self.sym_tune = match v as i32 {
                    1 => SymTune::Fifths,
                    2 => SymTune::Root,
                    _ => SymTune::Degrees,
                };
                return true;
            }
            "rootHz" => &mut self.root_hz,
            "atA1" => &mut self.osc[0].p1,
            "atA2" => &mut self.osc[0].p2,
            "atA3" => &mut self.osc[0].p3,
            "atAOct" => &mut self.osc[0].oct,
            "atB1" => &mut self.osc[1].p1,
            "atB2" => &mut self.osc[1].p2,
            "atB3" => &mut self.osc[1].p3,
            "atBOct" => &mut self.osc[1].oct,
            "atBlend" => &mut self.blend,
            "atUnison" => &mut self.unison,
            "atDetune" => &mut self.detune,
            "atWidth" => &mut self.width,
            "atDrift" => &mut self.drift,
            "atSub" => &mut self.sub,
            "atAir" => &mut self.air,
            "atGlide" => &mut self.glide,
            "atAtk" => &mut self.atk,
            "atDec" => &mut self.dec,
            "atSus" => &mut self.sus,
            "atRel" => &mut self.rel,
            "atVol" => &mut self.vol,
            "atFltType" => &mut self.flt_type,
            "atFltCut" => &mut self.flt_cut,
            "atFltRes" => &mut self.flt_res,
            "atFltKey" => &mut self.flt_key,
            "atFltAmt" => &mut self.flt_amt,
            "atFltAtk" => &mut self.flt_atk,
            "atFltDec" => &mut self.flt_dec,
            "atFltSus" => &mut self.flt_sus,
            "atFltRel" => &mut self.flt_rel,
            "atEns" => &mut self.ens,
            "atEnsRate" => &mut self.ens_rate,
            "atWow" => &mut self.wow,
            "atWarm" => &mut self.warm,
            "atSym" => &mut self.sym,
            "atSymRing" => &mut self.sym_ring,
            "atSymMat" => &mut self.sym_mat,
            _ => return false,
        };
        if v.is_finite() {
            *slot = v;
        }
        true
    }
}
