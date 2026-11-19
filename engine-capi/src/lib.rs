//! The engine core behind a C interface, for the JUCE app to link.
//!
//! One engine is two halves in one box. `ne_render` and `ne_frame` belong to
//! the audio thread; every other call belongs to the app's thread. Two calls
//! from the same half must never run at once.
//!
//! A frame of 0 means "at the next block". Calls that send a message return
//! its number (1, 2, 3 ...); a mistake comes back as a code below zero:
//!
//!  -1 number taken    -2 no such module     -3 no such socket or cable
//!  -4 kinds differ    -5 not audio          -6 too many cables into one input
//!  -7 loop, no delay  -8 bad sound number   -9 queue full
//! -10 no such kind of module               -11 no engine
//! -12 a panic was caught. ne_render now returns status (0 or -12); hosts
//! built against the old void signature must update their declaration.

use engine_core::basics::{
    Clock, Delay, Gain, Keys, Lfo, Mix, Player, Pulse, Sine, SoundSource, Voice,
};
use engine_core::{
    engine, port, AudioEngine, Config, Controller, EventKind, Module, NoteEvent, NoteKind,
    PatchError, SoundData, SoundRef,
};
use std::collections::VecDeque;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;
use std::slice;

pub struct NeEngine {
    ctl: Controller,
    audio: AudioEngine,
    rate: f32,
    /// Reports gathered but not yet read by `ne_applied`.
    applied: VecDeque<(u64, u64)>,
    failures: VecDeque<u32>,
}

pub const NE_SINE: u32 = 1;
pub const NE_GAIN: u32 = 2;
pub const NE_DELAY: u32 = 3;
pub const NE_LFO: u32 = 4;
pub const NE_CLOCK: u32 = 5;
pub const NE_PULSE: u32 = 6;
pub const NE_VOICE: u32 = 7;
pub const NE_KEYS: u32 = 8;
pub const NE_SOUND_SOURCE: u32 = 9;
pub const NE_PLAYER: u32 = 10;
/// MultiGrainLive's own (engine-mgl): the Wave synth with its default patch
/// and three built-in tables; MGL's master ceiling; a grain deck playing a
/// two-second test sound (a: 0 Granular, 1 WSOLA, 2 Vocoder, 3 PVSOLA;
/// b: Poly voices to make); a mixer (a: how many inputs).
pub const NE_WAVE: u32 = 11;
pub const NE_CEILING: u32 = 12;
pub const NE_GRAIN: u32 = 13;
pub const NE_MIX: u32 = 14;

const NO_ENGINE: i32 = -11;

/// The grain deck's own block, in samples.
const GRAIN_GRID: usize = 128;

fn code(error: PatchError) -> i32 {
    match error {
        PatchError::DuplicateModule(_) => -1,
        PatchError::BadModuleId(_) => -2,
        PatchError::NoSuchPort(_) => -3,
        PatchError::KindMismatch { .. } => -4,
        PatchError::NotAudio(_) => -5,
        PatchError::ManySources(_) => -6,
        PatchError::Cycle(_) => -7,
        PatchError::BadSoundId(_) => -8,
        PatchError::QueueFull => -9,
        PatchError::InvalidRate => -13,
        PatchError::UnsupportedRate(_) => -14,
        PatchError::RateBusy => -15,
    }
}

fn sent(result: Result<u64, PatchError>) -> i64 {
    match result {
        Ok(seq) => seq as i64,
        Err(error) => code(error) as i64,
    }
}

/// The app's half. Never the whole box: the audio thread may be in the other half.
/// The engine's rate. Read through the pointer, field by field, as `ctl` is:
/// the audio thread may be inside the other half at this moment.
unsafe fn rate_of(e: *mut NeEngine) -> Option<f32> {
    if e.is_null() {
        None
    } else {
        Some(ptr::addr_of!((*e).rate).read())
    }
}

unsafe fn ctl<'a>(e: *mut NeEngine) -> Option<&'a mut Controller> {
    if e.is_null() {
        None
    } else {
        Some(&mut *ptr::addr_of_mut!((*e).ctl))
    }
}

/// Make an engine. `log_applied` not 0: it reports where every message landed.
/// `fade_frames`: how long a cable fades when the patch changes (0: instant).
#[no_mangle]
pub extern "C" fn ne_new(
    rate: f32,
    max_block: u32,
    log_applied: u32,
    fade_frames: u32,
) -> *mut NeEngine {
    match catch_unwind(AssertUnwindSafe(|| {
        let config = Config {
            max_block: max_block.max(1) as usize,
            log_applied: log_applied != 0,
            fade_frames: fade_frames as usize,
            ..Config::default()
        };
        let (ctl, audio) = engine(rate, config);
        Box::into_raw(Box::new(NeEngine {
            ctl,
            audio,
            rate,
            applied: VecDeque::new(),
            failures: VecDeque::new(),
        }))
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            ptr::null_mut()
        }
    }
}

/// # Safety
/// `e` came from `ne_new`, and no other call is using it or will again.
#[no_mangle]
pub unsafe extern "C" fn ne_free(e: *mut NeEngine) {
    match catch_unwind(AssertUnwindSafe(|| {
        if !e.is_null() {
            drop(Box::from_raw(e));
        }
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            ()
        }
    }
}

/// The audio callback: make the next `n` samples of each side.
///
/// # Safety
/// `e` came from `ne_new`; `l` and `r` each point at `n` samples.
#[no_mangle]
pub unsafe extern "C" fn ne_render(e: *mut NeEngine, l: *mut f32, r: *mut f32, n: u32) -> i32 {
    if l.is_null() || r.is_null() {
        return NO_ENGINE;
    }
    let (l, r) = (
        slice::from_raw_parts_mut(l, n as usize),
        slice::from_raw_parts_mut(r, n as usize),
    );
    if e.is_null() {
        l.fill(0.0);
        r.fill(0.0);
        return NO_ENGINE;
    }
    let audio = &mut *ptr::addr_of_mut!((*e).audio);
    render_caught(audio, l, r, |audio, l, r| {
        audio.render(l, r);
        audio.finish(l, r);
    })
}

fn render_caught(
    audio: &mut AudioEngine,
    l: &mut [f32],
    r: &mut [f32],
    render: impl FnOnce(&mut AudioEngine, &mut [f32], &mut [f32]),
) -> i32 {
    let _audio = engine_core::rt::enter();
    let _no_denormals = engine_core::guard::NoDenormals::new();
    if audio.failed() {
        l.fill(0.0);
        r.fill(0.0);
        return -12;
    }
    match catch_unwind(AssertUnwindSafe(|| render(audio, l, r))) {
        Ok(()) => 0,
        Err(payload) => {
            l.fill(0.0);
            r.fill(0.0);
            audio.contain_panic(payload);
            -12
        }
    }
}

/// How many times something that was not a number was caught and silenced:
/// a module's output, or a whole block on its way out. It should stay at 0.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_bad_blocks(e: *mut NeEngine) -> u64 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return 0 };
        ctl.bad_blocks()
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            0
        }
    }
}

/// Frames made so far. Audio thread.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_frame(e: *mut NeEngine) -> u64 {
    match catch_unwind(AssertUnwindSafe(|| {
        if e.is_null() {
            return 0;
        }
        (*ptr::addr_of!((*e).audio)).frame()
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            0
        }
    }
}

/// Add a module. What `a` and `b` set depends on the kind: sine (pitch,
/// level), gain (gain), delay (samples), lfo (rate, depth), clock (tempo,
/// playing), pulse (note), player (level); and for MultiGrainLive's own,
/// see `NE_WAVE` and the kinds after it.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_add(e: *mut NeEngine, id: u32, kind: u32, a: f32, b: f32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        if kind == NE_GRAIN {
            let module = engine_mgl::demo::grain(ctl.rate() as u32, a as u32, GRAIN_GRID, b as usize);
            return ctl.add(id, Box::new(module)).map_or_else(code, |()| 0);
        }
        if kind == NE_WAVE {
            let module = engine_mgl::demo::wave(ctl.rate());
            return ctl.add(id, Box::new(module)).map_or_else(code, |()| 0);
        }
        if !(NE_SINE..=NE_MIX).contains(&kind) { return -10; }
        let factory = Box::new(move |rate: f32, _max: usize| -> Box<dyn Module> { match kind {
            NE_SINE => Box::new(Sine::new(a, b)),
            NE_GAIN => Box::new(Gain::new(a)),
            NE_DELAY => Box::new(Delay::new(a as usize)),
            NE_LFO => Box::new(Lfo::new(a, b)),
            NE_CLOCK => Box::new(Clock::new(a as f64, b >= 0.5)),
            NE_PULSE => Box::new(Pulse::new(a as u8)),
            NE_VOICE => Box::new(Voice::new()),
            NE_KEYS => Box::new(Keys::new()),
            NE_SOUND_SOURCE => Box::new(SoundSource::new()),
            NE_PLAYER => Box::new(Player::new(a)),
            NE_WAVE => Box::new(engine_mgl::demo::wave(rate)),
            NE_CEILING => Box::new(engine_mgl::Ceiling),
            NE_GRAIN => Box::new(engine_mgl::demo::grain(
                rate as u32,
                a as u32,
                GRAIN_GRID,
                b as usize,
            )),
            NE_MIX => Box::new(Mix::new(a as usize)),
            _ => unreachable!(),
        } });
        ctl.add_with_factory(id, factory).map_or_else(code, |()| 0)
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Add one of prism-fx's effects by its catalogue id ("dattorro-plate").
/// -10 if there is no such effect.
///
/// # Safety
/// `e` came from `ne_new`; `name` is a C string or null.
#[no_mangle]
pub unsafe extern "C" fn ne_add_fx(
    e: *mut NeEngine,
    id: u32,
    name: *const std::ffi::c_char,
) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(rate) = rate_of(e) else {
            return NO_ENGINE;
        };
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        if name.is_null() {
            return -10;
        }
        let Ok(name) = std::ffi::CStr::from_ptr(name).to_str() else {
            return -10;
        };
        match engine_mgl::Fx::new(name, rate) {
            Some(_) => {
                let name = name.to_owned();
                ctl.add_with_factory(id, Box::new(move |rate, _| Box::new(engine_mgl::Fx::new(&name, rate).unwrap())))
                    .map_or_else(code, |()| 0)
            },
            None => -10,
        }
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_remove(e: *mut NeEngine, id: u32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        if ctl.remove(id) {
            0
        } else {
            -2
        }
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_connect(
    e: *mut NeEngine,
    from_module: u32,
    from_port: u32,
    to_module: u32,
    to_port: u32,
) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        ctl.connect(port(from_module, from_port), port(to_module, to_port))
            .map_or_else(code, |()| 0)
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_disconnect(
    e: *mut NeEngine,
    from_module: u32,
    from_port: u32,
    to_module: u32,
    to_port: u32,
) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        if ctl.disconnect(port(from_module, from_port), port(to_module, to_port)) {
            0
        } else {
            -3
        }
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Send an audio output to the sound card.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_connect_out(e: *mut NeEngine, module: u32, out_port: u32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE };
        ctl.connect_out(port(module, out_port))
            .map_or_else(code, |()| 0)
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Compile the patch and send it to land on `frame`.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_commit(e: *mut NeEngine, frame: u64) -> i64 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else {
            return NO_ENGINE as i64;
        };
        sent(ctl.commit_at(frame))
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

unsafe fn send(e: *mut NeEngine, frame: u64, module: u32, kind: EventKind) -> i64 {
    let Some(ctl) = ctl(e) else {
        return NO_ENGINE as i64;
    };
    sent(if frame == 0 {
        ctl.send(module, kind)
    } else {
        ctl.send_at(frame, module, kind)
    })
}

/// Move a knob.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_param(
    e: *mut NeEngine,
    frame: u64,
    module: u32,
    index: u32,
    value: f32,
) -> i64 {
    match catch_unwind(AssertUnwindSafe(|| {
        send(e, frame, module, EventKind::Param { index, value })
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Send a note. `on`: 1 note on, 0 note off, 2 all notes off.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_note(
    e: *mut NeEngine,
    frame: u64,
    module: u32,
    on: u32,
    note: u32,
    velocity: f32,
) -> i64 {
    match catch_unwind(AssertUnwindSafe(|| {
        let kind = match on {
            0 => NoteKind::Off,
            1 => NoteKind::On,
            _ => NoteKind::AllOff,
        };
        let event = NoteEvent {
            kind,
            velocity,
            ..NoteEvent::on(note.min(127) as u8, velocity)
        };
        send(e, frame, module, EventKind::Note(event))
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Copy a sound into the bank under `id`. Returns its version (1, 2, 3 ...).
///
/// # Safety
/// `e` came from `ne_new`; `l` and `r` each point at `frames` samples.
#[no_mangle]
pub unsafe extern "C" fn ne_load_sound(
    e: *mut NeEngine,
    frame: u64,
    id: u32,
    l: *const f32,
    r: *const f32,
    frames: u32,
    rate: f32,
) -> i64 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else {
            return NO_ENGINE as i64;
        };
        if l.is_null() || r.is_null() {
            return -8;
        }
        let data = SoundData {
            rate,
            l: slice::from_raw_parts(l, frames as usize).into(),
            r: slice::from_raw_parts(r, frames as usize).into(),
        };
        match ctl.load_sound_at(frame, id, data) {
            Ok(sound) => sound.version as i64,
            Err(error) => code(error) as i64,
        }
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

/// Point one of a module's sound slots at a loaded sound.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_point_sound(
    e: *mut NeEngine,
    frame: u64,
    module: u32,
    slot: u32,
    id: u32,
    version: u32,
) -> i64 {
    match catch_unwind(AssertUnwindSafe(|| {
        send(
            e,
            frame,
            module,
            EventKind::Sound {
                slot,
                sound: SoundRef { id, version },
            },
        )
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            -12
        }
    }
}

unsafe fn gather(e: *mut NeEngine) -> u32 {
    let Some(ctl) = ctl(e) else { return 0 };
    let collected = ctl.collect();
    let applied = &mut *ptr::addr_of_mut!((*e).applied);
    applied.extend(ctl.take_applied());
    (collected.plans + collected.sounds) as u32
}

/// Free what the audio thread has finished with. Call it now and then.
/// Returns how many old plans and sounds were freed.
///
/// # Safety
/// `e` came from `ne_new`.
#[no_mangle]
pub unsafe extern "C" fn ne_collect(e: *mut NeEngine) -> u32 {
    match catch_unwind(AssertUnwindSafe(|| gather(e))) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            0
        }
    }
}

/// Read up to `max` reports of where messages landed: the message's number
/// into `seqs`, its frame into `frames`. Returns how many were written.
///
/// # Safety
/// `e` came from `ne_new`; `seqs` and `frames` each have room for `max`.
#[no_mangle]
pub unsafe extern "C" fn ne_applied(
    e: *mut NeEngine,
    seqs: *mut u64,
    frames: *mut u64,
    max: u32,
) -> u32 {
    match catch_unwind(AssertUnwindSafe(|| {
        if e.is_null() || seqs.is_null() || frames.is_null() {
            return 0;
        }
        gather(e);
        let applied = &mut *ptr::addr_of_mut!((*e).applied);
        let mut written = 0;
        while written < max {
            let Some((seq, frame)) = applied.pop_front() else {
                break;
            };
            *seqs.add(written as usize) = seq;
            *frames.add(written as usize) = frame;
            written += 1;
        }
        written
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            0
        }
    }
}

/// Read caught module ids on the controller thread; u32::MAX is a boundary
/// fault, which needs a new engine. Module faults need replacement + commit.
/// # Safety
/// e is a live engine; ids has max writable entries.
#[no_mangle]
pub unsafe extern "C" fn ne_panicked(e: *mut NeEngine, ids: *mut u32, max: u32) -> u32 {
    match catch_unwind(AssertUnwindSafe(|| {
        if e.is_null() || ids.is_null() {
            return 0;
        }
        gather(e);
        let ctl = ctl(e).unwrap();
        let reports = ctl.take_failures();
        let pending = &mut *ptr::addr_of_mut!((*e).failures);
        pending.extend(reports.into_iter().map(|failure| match failure {
            engine_core::Failure::ModulePanicked { id } => id,
            engine_core::Failure::BoundaryPanicked => u32::MAX,
        }));
        let mut n = 0;
        while n < max {
            let Some(id) = pending.pop_front() else { break };
            *ids.add(n as usize) = id;
            n += 1;
        }
        n
    })) {
        Ok(value) => value,
        Err(payload) => {
            std::mem::forget(payload);
            0
        }
    }
}

#[cfg(test)]
mod panic_tests {
    use super::*;
    struct Fault(usize);
    impl Module for Fault {
        fn inputs(&self) -> Vec<engine_core::Kind> {
            vec![]
        }
        fn outputs(&self) -> Vec<engine_core::Kind> {
            vec![engine_core::Kind::Audio]
        }
        fn process(&mut self, io: &mut engine_core::Io) {
            self.0 += 1;
            let (l, r) = io.outs.audio(0);
            l.fill(0.5);
            r.fill(0.5);
            if self.0 == 3 {
                panic!("intentional C render module panic");
            }
        }
    }
    #[test]
    fn c_render_contains_a_module_fault_and_reports_it_once() {
        unsafe {
            let e = ne_new(48000.0, 64, 0, 0);
            (*e).ctl.add(1, Box::new(Fault(0))).unwrap();
            (*e).ctl.connect_out(port(1, 0)).unwrap();
            (*e).ctl.add(2, Box::new(Sine::new(440.0, 0.1))).unwrap();
            (*e).ctl.connect_out(port(2, 0)).unwrap();
            (*e).ctl.commit().unwrap();
            let reference = ne_new(48000.0, 64, 0, 0);
            assert_eq!(ne_add(reference, 2, NE_SINE, 440.0, 0.1), 0);
            assert_eq!(ne_connect_out(reference, 2, 0), 0);
            assert!(ne_commit(reference, 0) > 0);
            let (mut l, mut r, mut a, mut b) = ([0.0; 64], [0.0; 64], [0.0; 64], [0.0; 64]);
            for block in 0..1003 {
                assert_eq!(ne_render(e, l.as_mut_ptr(), r.as_mut_ptr(), 64), 0);
                assert_eq!(ne_render(reference, a.as_mut_ptr(), b.as_mut_ptr(), 64), 0);
                if block >= 2 {
                    assert!(l.iter().zip(a).all(|(x, y)| x.to_bits() == y.to_bits()));
                    assert!(r.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits()));
                }
            }
            let mut ids = [0; 4];
            assert_eq!(ne_panicked(e, ids.as_mut_ptr(), 4), 1);
            assert_eq!(ids[0], 1);
            assert_eq!(ne_panicked(e, ids.as_mut_ptr(), 4), 0);
            ne_free(e);
            ne_free(reference);
        }
    }
    #[test]
    fn a_last_resort_boundary_fault_silences_and_disables_rendering() {
        let (mut ctl, mut audio) = engine(48000.0, Config::default());
        let mut l = [1.0; 64];
        let mut r = [1.0; 64];
        assert_eq!(
            render_caught(&mut audio, &mut l, &mut r, |_, l, _| {
                l[0] = 0.75;
                panic!("outside a module");
            }),
            -12
        );
        assert!(l.iter().chain(&r).all(|x| *x == 0.0));
        assert_eq!(
            render_caught(&mut audio, &mut l, &mut r, |_, _, _| panic!(
                "must not retry"
            )),
            -12
        );
        ctl.collect();
        assert_eq!(
            ctl.take_failures(),
            vec![engine_core::Failure::BoundaryPanicked]
        );
    }
}

/// Rebuild the patch for a new output rate, on the controller thread.
/// 0 queued; -13 invalid rate; -14 module has no factory; -15 change still fading.
/// # Safety
/// `e` came from ne_new. Must not overlap another controller call.
#[no_mangle]
pub unsafe extern "C" fn ne_set_rate(e: *mut NeEngine, rate: f32) -> i32 {
    match catch_unwind(AssertUnwindSafe(|| {
        let Some(ctl) = ctl(e) else { return NO_ENGINE; };
        match ctl.set_rate(rate) {
            Ok(_) => { ptr::addr_of_mut!((*e).rate).write(rate); 0 },
            Err(error) => code(error),
        }
    })) {
        Ok(status) => status,
        Err(payload) => { std::mem::forget(payload); -12 }
    }
}
