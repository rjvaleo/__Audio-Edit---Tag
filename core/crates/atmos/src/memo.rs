//! Local scalar memo, so the standalone wasm synth needs no effects dependency.
#[derive(Clone, Copy)]
pub(crate) struct Memo<const N: usize, T: Copy> { last: Option<([u32; N], T)> }
impl<const N: usize, T: Copy> Default for Memo<N, T> {
    fn default() -> Self { Self { last: None } }
}
impl<const N: usize, T: Copy> Memo<N, T> {
    pub const fn new() -> Self { Self { last: None } }
    #[inline(always)]
    pub fn get(&mut self, input: [f32; N], calculate: impl FnOnce() -> T) -> T {
        let bits = input.map(f32::to_bits);
        if let Some((old, value)) = self.last { if old == bits { return value; } }
        let value = calculate();
        self.last = Some((bits, value));
        value
    }
}
