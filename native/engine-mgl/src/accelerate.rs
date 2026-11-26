//! Apple's Accelerate, bound for `dsp_core::chromium::vdsp`: on a Mac the
//! page's Web Audio does its FFTs, convolutions and vector sums with vDSP,
//! and only vDSP itself gives their last bits. [`install`] hands these to
//! the Chromium port; elsewhere it does nothing and the port does the sums
//! itself.

#[cfg(target_vendor = "apple")]
mod sys {
    #[repr(C)]
    pub struct DSPSplitComplex {
        pub realp: *mut f32,
        pub imagp: *mut f32,
    }
    #[link(name = "Accelerate", kind = "framework")]
    extern "C" {
        pub fn vDSP_create_fftsetup(log2n: usize, radix: i32) -> *mut core::ffi::c_void;
        pub fn vDSP_destroy_fftsetup(setup: *mut core::ffi::c_void);
        pub fn vDSP_fft_zrip(setup: *mut core::ffi::c_void, c: *const DSPSplitComplex, stride: isize, log2n: usize, direction: i32);
        pub fn vDSP_ctoz(c: *const f32, ic: isize, z: *const DSPSplitComplex, iz: isize, n: usize);
        pub fn vDSP_ztoc(z: *const DSPSplitComplex, iz: isize, c: *mut f32, ic: isize, n: usize);
        pub fn vDSP_zvmul(a: *const DSPSplitComplex, ia: isize, b: *const DSPSplitComplex, ib: isize, c: *const DSPSplitComplex, ic: isize, n: usize, conjugate: i32);
        pub fn vDSP_conv(a: *const f32, ia: isize, f: *const f32, if_: isize, c: *mut f32, ic: isize, n: usize, p: usize);
        pub fn vDSP_vsmul(a: *const f32, ia: isize, b: *const f32, c: *mut f32, ic: isize, n: usize);
        pub fn vDSP_vadd(a: *const f32, ia: isize, b: *const f32, ib: isize, c: *mut f32, ic: isize, n: usize);
        pub fn vDSP_svesq(a: *const f32, ia: isize, c: *mut f32, n: usize);
    }
}

#[cfg(target_vendor = "apple")]
mod bound {
    use super::sys::*;
    use dsp_core::chromium::vdsp::Backend;

    fn create(log2n: usize) -> usize {
        unsafe { vDSP_create_fftsetup(log2n, 0) as usize }
    }
    fn destroy(s: usize) {
        unsafe { vDSP_destroy_fftsetup(s as *mut core::ffi::c_void) }
    }
    fn forward(s: usize, log2n: usize, data: &[f32], real: &mut [f32], imag: &mut [f32]) {
        let half = 1usize << (log2n - 1);
        assert!(data.len() >= 2 * half && real.len() >= half && imag.len() >= half);
        unsafe {
            let z = DSPSplitComplex { realp: real.as_mut_ptr(), imagp: imag.as_mut_ptr() };
            vDSP_ctoz(data.as_ptr(), 2, &z, 1, half);
            vDSP_fft_zrip(s as *mut core::ffi::c_void, &z, 1, log2n, 1);
        }
    }
    fn inverse(s: usize, log2n: usize, real: &mut [f32], imag: &mut [f32], data: &mut [f32]) {
        let half = 1usize << (log2n - 1);
        assert!(data.len() >= 2 * half && real.len() >= half && imag.len() >= half);
        unsafe {
            let z = DSPSplitComplex { realp: real.as_mut_ptr(), imagp: imag.as_mut_ptr() };
            vDSP_fft_zrip(s as *mut core::ffi::c_void, &z, 1, log2n, -1);
            vDSP_ztoc(&z, 1, data.as_mut_ptr(), 2, half);
        }
    }
    fn zvmul(ar: &mut [f32], ai: &mut [f32], br: &[f32], bi: &[f32]) {
        let n = ar.len().min(ai.len()).min(br.len()).min(bi.len());
        unsafe {
            let a = DSPSplitComplex { realp: ar.as_mut_ptr(), imagp: ai.as_mut_ptr() };
            let b = DSPSplitComplex { realp: br.as_ptr() as *mut f32, imagp: bi.as_ptr() as *mut f32 };
            vDSP_zvmul(&a, 1, &b, 1, &a, 1, n, 1);
        }
    }
    fn conv(source: &[f32], filter: &[f32], dest: &mut [f32]) {
        let (n, p) = (dest.len(), filter.len());
        assert!(p > 0 && source.len() >= n + p - 1);
        unsafe { vDSP_conv(source.as_ptr(), 1, filter.as_ptr().add(p - 1), -1, dest.as_mut_ptr(), 1, n, p) }
    }
    fn vsmul(source: &[f32], scale: f32, dest: &mut [f32]) {
        let n = source.len().min(dest.len());
        unsafe { vDSP_vsmul(source.as_ptr(), 1, &scale, dest.as_mut_ptr(), 1, n) }
    }
    fn vadd_into(a: &[f32], dest: &mut [f32]) {
        let n = a.len().min(dest.len());
        unsafe { vDSP_vadd(a.as_ptr(), 1, dest.as_ptr(), 1, dest.as_mut_ptr(), 1, n) }
    }
    fn svesq(a: &[f32]) -> f32 {
        let mut s = 0.0f32;
        unsafe { vDSP_svesq(a.as_ptr(), 1, &mut s, a.len()) };
        s
    }

    pub static BACKEND: Backend = Backend {
        create_fft_setup: create,
        destroy_fft_setup: destroy,
        forward,
        inverse,
        zvmul,
        conv,
        vsmul,
        vadd_into,
        svesq,
    };
}

/// Hand Accelerate to the Chromium port (on Apple's systems; once).
pub fn install() {
    #[cfg(target_vendor = "apple")]
    dsp_core::chromium::vdsp::install(&bound::BACKEND);
}
