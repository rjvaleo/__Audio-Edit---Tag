//! The two things every audio callback is wrapped in, whoever owns the sound
//! card: numbers too small to hear are treated as zero while it runs, and
//! nothing that is not a number, or is past full scale, leaves it.

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
/// Set on the audio thread only: an offline render keeps the processor's
/// ordinary mode, so the two can differ below that size and nowhere else.
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

/// The last stage before the sound card: a block that holds anything that is
/// not a number is silenced whole, and nothing is left past full scale. Says
/// whether the block was silenced.
///
/// Samples between −1 and 1 are not touched, so a block that was already fit to
/// play goes out bit for bit.
#[inline]
pub fn finish(out: &mut [f32]) -> bool {
    if !fx::all_finite(out) {
        out.fill(0.0);
        return true;
    }
    for x in out.iter_mut() {
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
        let mut out = was.clone();
        assert!(!finish(&mut out));
        assert_eq!(out.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), was.iter().map(|x| x.to_bits()).collect::<Vec<_>>());
    }

    #[test]
    fn nothing_past_full_scale_and_nothing_that_is_not_a_number_gets_out() {
        let mut out = vec![0.5, 1.5, -3.0, f32::INFINITY.min(9.0)];
        assert!(!finish(&mut out));
        assert_eq!(out, vec![0.5, 1.0, -1.0, 1.0]);
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut out = vec![0.25, bad, 0.25];
            assert!(finish(&mut out));
            assert_eq!(out, vec![0.0, 0.0, 0.0]);
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
