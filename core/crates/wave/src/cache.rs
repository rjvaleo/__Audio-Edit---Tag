//! Reuse pure scalar expressions only when every input bit is unchanged.
#[derive(Clone, Copy)]
pub(crate) struct Last<const N: usize, T: Copy> {
    value: Option<([u32; N], T)>,
}
impl<const N: usize, T: Copy> Last<N, T> {
    pub const fn new() -> Self { Self { value: None } }
    #[inline]
    pub fn get(&mut self, input: [f32; N], calculate: impl FnOnce() -> T) -> T {
        let bits = input.map(f32::to_bits);
        if let Some((old, value)) = self.value {
            if old == bits { return value; }
        }
        let value = calculate();
        self.value = Some((bits, value));
        value
    }
}
