//! Guards for the host audio callback and non-finite module output.
//! Offline engine renders keep the caller's floating-point mode.
#![allow(unsafe_code)]

/// While this lives, the processor rounds denormal results to zero and reads
/// denormal inputs as zero. Made at the top of the audio callback and dropped
/// at its end, which puts the thread's mode back as it was.
///
/// A reverb's tank or a filter's memory decaying towards silence passes through
/// numbers below 1.2e-38. An Intel or AMD processor works on those in
/// microcode, tens of times slower than on ordinary ones, so a quiet tail could
/// cost more than a loud one and the callback ran late. Nothing above that size
/// is changed.
///
/// The host callback holds one through `ne_render`, including the probe's
/// replay. Direct engine renders preserve the recorded effect outputs.
pub struct NoDenormals {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    was: u64,
}

impl NoDenormals {
    #[inline]
    pub fn new() -> NoDenormals {
        #[cfg(target_arch = "x86_64")]
        {
            // MXCSR: flush to zero (bit 15) and denormals are zero (bit 6).
            let mut was: u32 = 0;
            let now: u32;
            // SAFETY: reads and writes this thread's SSE control register
            // through a pointer to a local; no memory else is touched.
            unsafe {
                core::arch::asm!("stmxcsr [{}]", in(reg) &mut was as *mut u32, options(nostack, preserves_flags));
                now = was | 0x8040;
                core::arch::asm!("ldmxcsr [{}]", in(reg) &now as *const u32, options(nostack, preserves_flags, readonly));
            }
            NoDenormals { was: was as u64 }
        }
        #[cfg(target_arch = "aarch64")]
        {
            // FPCR: flush to zero (bit 24).
            let was: u64;
            // SAFETY: reads and writes this thread's floating-point control
            // register; no memory is touched.
            unsafe {
                core::arch::asm!("mrs {}, fpcr", out(reg) was, options(nomem, nostack, preserves_flags));
                core::arch::asm!("msr fpcr, {}", in(reg) was | (1 << 24), options(nomem, nostack, preserves_flags));
            }
            NoDenormals { was }
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            NoDenormals {}
        }
    }
}

impl Default for NoDenormals {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for NoDenormals {
    #[inline]
    fn drop(&mut self) {
        #[cfg(target_arch = "x86_64")]
        {
            let was = self.was as u32;
            // SAFETY: as in `new`.
            unsafe {
                core::arch::asm!("ldmxcsr [{}]", in(reg) &was as *const u32, options(nostack, preserves_flags, readonly));
            }
        }
        #[cfg(target_arch = "aarch64")]
        {
            // SAFETY: as in `new`.
            unsafe {
                core::arch::asm!("msr fpcr, {}", in(reg) self.was, options(nomem, nostack, preserves_flags));
            }
        }
    }
}

/// True if every sample is a number: no NaN, no infinity. One pass over the
/// bits with no early way out, so it is a handful of instructions a block.
#[inline]
pub fn all_finite(buf: &[f32]) -> bool {
    const EXP: u32 = 0x7f80_0000;
    let mut bad = 0u32;
    for x in buf {
        bad |= ((x.to_bits() & EXP) == EXP) as u32;
    }
    bad == 0
}

/// The last stage before the sound card, for whoever owns it: a block that
/// holds anything that is not a number is silenced whole, and nothing is left
/// past full scale. Says whether the block was silenced.
///
/// Samples between -1 and 1 are not touched, so a block that was already fit to
/// play goes out bit for bit. The engine's own `render` does not do this: a
/// test, or a render to a file, wants what the patch made, however loud.
#[inline]
pub fn finish(left: &mut [f32], right: &mut [f32]) -> bool {
    if !all_finite(left) || !all_finite(right) {
        left.fill(0.0);
        right.fill(0.0);
        return true;
    }
    for x in left.iter_mut().chain(right.iter_mut()) {
        *x = x.clamp(-1.0, 1.0);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_block_fit_to_play_goes_out_bit_for_bit() {
        let was: Vec<f32> = (0..512).map(|i| ((i as f32) * 0.37).sin()).chain([1.0, -1.0, 0.0, -0.0]).collect();
        let (mut l, mut r) = (was.clone(), was.clone());
        assert!(!finish(&mut l, &mut r));
        let bits = |x: &[f32]| x.iter().map(|x| x.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&l), bits(&was));
        assert_eq!(bits(&r), bits(&was));
    }

    #[test]
    fn nothing_past_full_scale_and_nothing_that_is_not_a_number_gets_out() {
        let (mut l, mut r) = (vec![0.5, 1.5], vec![-3.0, 9.0]);
        assert!(!finish(&mut l, &mut r));
        assert_eq!((l, r), (vec![0.5, 1.0], vec![-1.0, 1.0]));
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let (mut l, mut r) = (vec![0.25, 0.25], vec![0.25, bad]);
            assert!(finish(&mut l, &mut r));
            assert_eq!((l, r), (vec![0.0, 0.0], vec![0.0, 0.0]));
        }
    }

    /// Half the smallest ordinary number. Never inlined, so each call is worked
    /// out afresh under whatever mode the thread is then in: the compiler takes
    /// the mode to be the ordinary one and would reuse the first answer.
    #[inline(never)]
    fn half_the_smallest() -> f32 {
        std::hint::black_box(f32::MIN_POSITIVE) * std::hint::black_box(0.5f32)
    }

    /// The smallest ordinary number halved is a denormal; under the guard it is
    /// zero, and after the guard the thread is as it was.
    #[test]
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    fn under_the_guard_a_denormal_is_zero_and_after_it_is_not() {
        assert!(half_the_smallest() > 0.0);
        {
            let _guard = NoDenormals::new();
            assert_eq!(half_the_smallest(), 0.0);
        }
        assert!(half_the_smallest() > 0.0);
    }
}

/// A worker uses the caller's exact floating-point controls, including the
/// difference between offline renders and the host's denormal guard.
#[derive(Clone, Copy)]
pub(crate) struct FloatMode(u64);
impl FloatMode {
    pub(crate) fn capture() -> Self {
        #[cfg(target_arch="aarch64")]
        unsafe { let value:u64; core::arch::asm!("mrs {}, fpcr",out(reg)value,options(nomem,nostack,preserves_flags)); Self(value) }
        #[cfg(target_arch="x86_64")]
        unsafe { let mut value=0u32;core::arch::asm!("stmxcsr [{}]",in(reg)&mut value,options(nostack,preserves_flags));Self(value as u64) }
        #[cfg(not(any(target_arch="aarch64",target_arch="x86_64")))]
        {Self(0)}
    }
    fn set(self) {
        #[cfg(target_arch="aarch64")]
        unsafe{core::arch::asm!("msr fpcr, {}",in(reg)self.0,options(nomem,nostack,preserves_flags));}
        #[cfg(target_arch="x86_64")]
        unsafe{let value=self.0 as u32;core::arch::asm!("ldmxcsr [{}]",in(reg)&value,options(nostack,preserves_flags,readonly));}
    }
    pub(crate) fn enter(self)->RestoreMode {let previous=Self::capture();self.set();RestoreMode(previous)}
}
pub(crate) struct RestoreMode(FloatMode);
impl Drop for RestoreMode {fn drop(&mut self){self.0.set();}}
