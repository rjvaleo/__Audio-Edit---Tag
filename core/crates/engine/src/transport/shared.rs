//! What the audio thread and the rest share: `impl Shared`.

/// How many switched slots may wait either side of the audio thread at once.
const RETIRED_ROOM: usize = 16;

use super::*;

/// The slot if nobody is in it, without waiting. A slot whose last holder
/// panicked is still taken: what it holds is only ever replaced whole.
fn free<T>(slot: &Mutex<T>) -> Option<std::sync::MutexGuard<'_, T>> {
    match slot.try_lock() {
        Ok(g) => Some(g),
        Err(std::sync::TryLockError::Poisoned(p)) => Some(p.into_inner()),
        Err(std::sync::TryLockError::WouldBlock) => None,
    }
}

impl Shared {
    pub fn new(params: StreamParams, source: Arc<Source>) -> Self {
        let shared = Shared::unlocked(params, source);
        // On macOS a lock makes its system lock the first time it is locked,
        // which is an allocation. The audio thread only ever tries these
        // locks, and it must not be the first to: lock each once, here.
        drop(shared.params.lock());
        drop(shared.source.lock());
        drop(shared.events.lock());
        drop(shared.pitch_time.lock());
        drop(shared.pending_rack.lock());
        drop(shared.pending_swaps.lock());
        drop(shared.retired_effects.lock());
        drop(shared.retired.lock());
        drop(shared.pending_map.lock());
        drop(shared.pending_parts.lock());
        drop(shared.pending_bank.lock());
        drop(shared.automation.lock());
        drop(shared.manual.lock());
        drop(shared.spectrum.lock());
        drop(shared.waveform.lock());
        drop(shared.scope.lock());
        drop(shared.pre_rack.lock());
        drop(shared.capture.lock());
        drop(shared.parts_now.lock());
        shared
    }

    fn unlocked(params: StreamParams, source: Arc<Source>) -> Self {
        Shared {
            voices: crate::voices::VoiceFeed::new(),
            params: Mutex::new(params),
            source: Mutex::new(source),
            events: Mutex::new(Vec::with_capacity(EVENTS_ROOM)),
            playing: AtomicBool::new(false),
            position: AtomicU64::new(0),
            seek: AtomicI64::new(-1),
            loop_on: AtomicBool::new(false),
            loop_a: AtomicU64::new(0),
            loop_b: AtomicU64::new(0),
            heard_a: AtomicU64::new(0),
            heard_b: AtomicU64::new(0),
            latency: AtomicU64::new(0),
            gain: AtomicU32::new(1.0f32.to_bits()),
            speed: AtomicU32::new(1.0f32.to_bits()),
            glide: AtomicU32::new(0),
            gain_l: AtomicU32::new(1.0f32.to_bits()),
            gain_r: AtomicU32::new(1.0f32.to_bits()),
            pitch_time: Mutex::new(PitchTime::default()),
            post_roll: AtomicU64::new(0),
            mute: AtomicBool::new(false),
            seq: SeqBus::new(SEQ_BUS_FRAMES),
            overflows: AtomicU64::new(0),
            load_now: AtomicU32::new(0),
            load_mean: AtomicU32::new(0),
            load_worst: AtomicU32::new(0),
            load_window: AtomicU32::new(0),
            late_total: AtomicU64::new(0),
            late_blocks: AtomicU64::new(0),
            bad_blocks: AtomicU64::new(0),
            layer_cap: AtomicU32::new(crate::render::MAX_LAYERS as u32),
            shed_layers: AtomicBool::new(false),
            hot: AtomicU32::new(0),
            cool: AtomicU32::new(0),
            layers_running: AtomicU32::new(1),
            pending_rack: Mutex::new(None),
            pending_swaps: Mutex::new(Vec::with_capacity(RETIRED_ROOM)),
            retired_effects: Mutex::new(Vec::with_capacity(RETIRED_ROOM)),
            retired: Mutex::new(Vec::with_capacity(RETIRED_THINGS)),
            pending_map: Mutex::new(None),
            pending_parts: Mutex::new(None),
            parts_now: Mutex::new(None),
            octaves: crate::octaves::OctaveSlot::new(),
            pending_bank: Mutex::new(None),
            bank_layers: AtomicU32::new(1),
            rack_meters: Arc::new(fx::RackMeters::new()),
            automation: Mutex::new(Vec::new()),
            manual: Mutex::new(Vec::new()),
            // Their full size from the start: the audio thread fills them and
            // must never grow them.
            spectrum: Mutex::new(Vec::with_capacity(FFT_SIZE / 2 + 1)),
            waveform: Mutex::new(Vec::with_capacity(WAVE_POINTS)),
            scope: Mutex::new(Scope::new()),
            pre_rack: Mutex::new(Scope::new()),
            pre_rack_left: AtomicU32::new(0),
            capture: Mutex::new(None),
            capturing: AtomicBool::new(false),
            captured: AtomicU64::new(0),
        }
    }

    /// Begin keeping what comes out, up to `seconds` of it.
    ///
    /// The whole buffer is reserved now, on this thread, because the callback
    /// is not allowed to allocate. Running out is not an error — the recording
    /// simply stops growing, and the flag says so.
    pub fn start_capture(&self, channels: usize, sample_rate: u32, seconds: f32) {
        let cap = (sample_rate as f32 * seconds) as usize * channels.max(1);
        if let Ok(mut g) = self.capture.lock() {
            *g = Some(Capture {
                samples: Vec::with_capacity(cap),
                channels: channels.max(1),
                sample_rate,
                full: false,
            });
        }
        self.captured.store(0, Ordering::Release);
        self.capturing.store(true, Ordering::Release);
    }

    /// Stop, and hand back what was kept.
    pub fn take_capture(&self) -> Option<Capture> {
        self.capturing.store(false, Ordering::Release);
        self.capture.lock().ok().and_then(|mut g| g.take())
    }

    pub fn is_capturing(&self) -> bool {
        self.capturing.load(Ordering::Acquire)
    }

    /// How much has been kept so far, in frames.
    pub fn captured_frames(&self) -> u64 {
        self.captured.load(Ordering::Acquire)
    }

    pub fn set_params(&self, p: StreamParams) {
        if let Ok(mut g) = self.params.lock() {
            *g = p;
        }
    }

    pub fn params(&self) -> Option<StreamParams> {
        self.params.lock().ok().map(|g| *g)
    }

    /// Read, change and put back in one hold of the lock, for a thread that
    /// does so a hundred times a second: a slider landing between its read and
    /// its write would otherwise be lost.
    pub fn update_params(&self, f: impl FnOnce(&mut StreamParams)) {
        if let Ok(mut g) = self.params.lock() {
            f(&mut g);
        }
    }

    /// The audio currently loaded, for callers that need to derive something
    /// from it off the audio thread — the transient map, for instance.
    pub fn source(&self) -> Option<Arc<Source>> {
        self.source.lock().ok().map(|g| Arc::clone(&g))
    }

    /// Leave a new sound for the audio thread to pick up. The sound it stops
    /// playing comes back on the list [`Shared::collect`] frees.
    pub fn set_source(&self, s: Arc<Source>) {
        if let Ok(mut g) = self.source.lock() {
            *g = s;
        }
        // The copies an octave up were of the old one.
        self.octaves.clear();
    }

    /// Make the copies of the sound an octave or more up now, on this thread,
    /// for an export or a test; the live deck makes them when a key asks.
    pub fn build_octaves(&self) {
        if let Some(src) = self.source() {
            let parts = self.parts_now.lock().ok().and_then(|g| g.clone());
            let parts = parts.filter(|p| !p.is_empty() && p.frames() == src.frames());
            self.octaves.build_now(&src, parts.as_deref());
        }
    }

    pub fn play(&self) {
        self.playing.store(true, Ordering::Release);
    }

    pub fn pause(&self) {
        self.playing.store(false, Ordering::Release);
    }

    pub fn is_playing(&self) -> bool {
        self.playing.load(Ordering::Acquire)
    }

    pub fn position(&self) -> u64 {
        self.position.load(Ordering::Acquire)
    }

    pub fn request_seek(&self, frame: u64) {
        self.seek.store(frame as i64, Ordering::Release);
    }

    /// The loop the callback last used: start, end, and whether there is one.
    pub fn heard_loop(&self) -> Option<(u64, u64)> {
        let b = self.heard_b.load(Ordering::Acquire);
        if b == 0 {
            None
        } else {
            Some((self.heard_a.load(Ordering::Acquire), b))
        }
    }

    pub fn latency_frames(&self) -> u64 {
        self.latency.load(Ordering::Acquire)
    }

    pub fn set_latency_frames(&self, frames: u64) {
        self.latency.store(frames, Ordering::Release);
    }

    /// What the last block cost, against the time it will take to play.
    ///
    /// Called from the audio thread with the block's own duration, so nothing
    /// here may allocate or lock. One over means the engine is behind and the
    /// device will run out of audio.
    pub fn record_block_cost(&self, took: std::time::Duration, budget: std::time::Duration) {
        let b = budget.as_secs_f64();
        if b <= 0.0 {
            return;
        }
        let frac = took.as_secs_f64() / b;
        // Saturating: a stall while a debugger is attached should read as "very
        // late" rather than wrap to nothing.
        let ppm = (frac * 1_000_000.0).min(u32::MAX as f64) as u32;
        self.load_now.store(ppm, Ordering::Relaxed);

        // A slow average, so a meter reads as a level rather than a flicker.
        // 1/32 per block is about a fifth of a second at 512 frames and 48 kHz.
        let prev = self.load_mean.load(Ordering::Relaxed);
        let mean = if prev == 0 { ppm } else { prev - (prev >> 5) + (ppm >> 5) };
        self.load_mean.store(mean, Ordering::Relaxed);

        // Decide how many layers the machine can actually carry.
        //
        // This is the same `govern` that was pulled out on 15 Aug for causing
        // the glitching it was meant to prevent — and it was never the culprit.
        // What was: the callback applied the verdict by writing it back into its
        // own persistent parameters, `self.params.grain.layers = allowed`, so the
        // next block read the already-reduced number and reduced it again. A
        // ratchet, sixteen layers to one while you listened, rebuilding the bank
        // at every step.
        //
        // The verdict is a *cap* now, read by `Stretcher::live_layers` and never
        // written anywhere. The requested count is untouched, so the cap is
        // recomputed against what you asked for rather than against its own last
        // answer, and it cannot walk.
        self.govern(ppm, mean);

        // The worst since the last reset. `fetch_max` rather than a load, a
        // compare and a store, which two callbacks could interleave.
        self.load_worst.fetch_max(ppm, Ordering::Relaxed);
        self.load_window.fetch_max(ppm, Ordering::Relaxed);
        if ppm > 1_000_000 {
            self.late_blocks.fetch_add(1, Ordering::Relaxed);
            self.late_total.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// DISABLED. Kept only so the tests that document why can still run.
    ///
    /// Shed layers when the callback cannot keep up, and take them back when it
    /// can.
    ///
    /// **Falls fast, climbs slowly.** Evidence for shedding accumulates four
    /// times faster than it decays, so a run of late blocks acts within about a
    /// dozen of them; evidence for recovering has to hold for hundreds. Getting
    /// this the other way round gives a cloud that flaps between thick and thin,
    /// which is more distracting than either.
    ///
    /// Layers rather than window or density because layers are the dominant
    /// multiplier — each one is another whole engine — and because thinning a
    /// cloud is the least destructive of the three. The sound gets smaller, not
    /// wrong.
    fn govern(&self, ppm: u32, mean: u32) {
        // Switched off: the cap stays where it belongs and nothing is taken
        // away. Held rather than merely skipped, so turning it off while it has
        // already shed gives the layers straight back instead of waiting out
        // four hundred easy blocks per layer to climb home.
        if !self.shed_layers.load(Ordering::Relaxed) {
            let full = crate::render::MAX_LAYERS as u32;
            if self.layer_cap.load(Ordering::Relaxed) != full {
                self.layer_cap.store(full, Ordering::Relaxed);
                self.hot.store(0, Ordering::Relaxed);
                self.cool.store(0, Ordering::Relaxed);
            }
            return;
        }

        /// A block that did not make its deadline. This is not "load is high",
        /// it is a hole in the sound.
        const LATE: u32 = 1_000_000;
        const OVER: u32 = 900_000;
        const EASY: u32 = 450_000;
        /// Evidence needed before a layer goes. Two missed deadlines is a
        /// coincidence; a run of them is a setting that does not fit.
        const SHED_AT: u32 = 64;
        let cap = self.layer_cap.load(Ordering::Relaxed);

        // Weighted by what was actually heard.
        //
        // This used to add 4 for anything past 90% of budget and subtract 1 for
        // every block that was not, which is only ever reached by a *sustained*
        // overload. The load that people actually complain about is spiky: the
        // "Breaking Again" preset sits at 68% of budget and misses about 1.5
        // deadlines a second, which is a click and a half a second and reads as
        // crackling. Through the old arithmetic that came to +5.8 against -22.0
        // per second — it could not reach the threshold from there, ever, and
        // the engine glitched along at a comfortable-looking average.
        //
        // A missed deadline now counts for eight times as much as merely being
        // busy, so that same 1.5 a second crosses the line in about two and a
        // half seconds. Being busy without missing anything still costs nothing.
        let step = if ppm >= LATE {
            32
        } else if ppm > OVER {
            4
        } else {
            0
        };
        if step > 0 {
            let hot = self.hot.fetch_add(step, Ordering::Relaxed) + step;
            if hot >= SHED_AT {
                self.hot.store(0, Ordering::Relaxed);
                self.cool.store(0, Ordering::Relaxed);
                // Shed from what is *running*, not from the abstract ceiling.
                //
                // The cap starts at sixteen whatever the document asks for, so
                // decrementing it on a three-layer document would spend fourteen
                // sheds — a good half-minute of crackling — before it changed
                // anything at all. What is running is the number that matters.
                let running = self.layers_running.load(Ordering::Relaxed).max(1);
                let base = cap.min(running);
                if base > 1 {
                    self.layer_cap.store(base - 1, Ordering::Relaxed);
                }
            }
            return;
        }

        let hot = self.hot.load(Ordering::Relaxed);
        if hot > 0 {
            self.hot.store(hot.saturating_sub(1), Ordering::Relaxed);
        }

        // Recovery is judged on the average, not the last block: one cheap block
        // says nothing about whether there is room for another engine.
        if mean < EASY && cap < crate::render::MAX_LAYERS as u32 {
            let cool = self.cool.fetch_add(1, Ordering::Relaxed) + 1;
            if cool >= 400 {
                self.cool.store(0, Ordering::Relaxed);
                self.layer_cap.store(cap + 1, Ordering::Relaxed);
            }
        } else {
            self.cool.store(0, Ordering::Relaxed);
        }
    }

    /// The most layers the callback may run right now.
    pub fn layer_cap(&self) -> u32 {
        self.layer_cap.load(Ordering::Relaxed)
    }

    /// Give the governor its head back. Called when the document changes, since
    /// a cap earned by one setting says nothing about the next.
    /// Whether the governor may take layers away. See [`Shared::shed_layers`].
    pub fn set_shed_layers(&self, on: bool) {
        self.shed_layers.store(on, Ordering::Relaxed);
        if !on {
            self.reset_governor();
        }
    }

    pub fn sheds_layers(&self) -> bool {
        self.shed_layers.load(Ordering::Relaxed)
    }

    pub fn reset_governor(&self) {
        self.layer_cap
            .store(crate::render::MAX_LAYERS as u32, Ordering::Relaxed);
        self.hot.store(0, Ordering::Relaxed);
        self.cool.store(0, Ordering::Relaxed);
    }

    /// Last, averaged and worst block cost, as a fraction of the budget.
    pub fn load(&self) -> (f32, f32, f32) {
        let f = |v: u32| v as f32 / 1_000_000.0;
        (
            f(self.load_now.load(Ordering::Relaxed)),
            f(self.load_mean.load(Ordering::Relaxed)),
            f(self.load_worst.load(Ordering::Relaxed)),
        )
    }

    /// The worst block since the last call, as a fraction of the budget, and
    /// late blocks since the engine started. For the analytics sampler, which
    /// calls it every few seconds from its own thread: a swap and a load, so
    /// the audio thread is never kept waiting.
    pub fn take_load_window(&self) -> (f32, u64) {
        (
            self.load_window.swap(0, Ordering::Relaxed) as f32 / 1_000_000.0,
            self.late_total.load(Ordering::Relaxed),
        )
    }

    /// Forget the worst. The interface offers this because the number is only
    /// useful next to a change you just made — a peak from ten minutes ago says
    /// nothing about the settings in front of you.
    pub fn reset_load(&self) {
        self.load_worst.store(0, Ordering::Relaxed);
        self.late_blocks.store(0, Ordering::Relaxed);
    }

    pub fn set_loop(&self, on: bool, a: u64, b: u64) {
        self.loop_a.store(a, Ordering::Release);
        self.loop_b.store(b, Ordering::Release);
        self.loop_on.store(on, Ordering::Release);
    }

    /// Hand a freshly built rack to the audio thread. Replacing an unclaimed
    /// one is fine: only the newest settings matter.
    /// Leave a bank of extra layers for the audio thread to pick up.
    pub fn set_bank(&self, bank: crate::stretcher::LayerBank) {
        self.bank_layers.store(bank.layers.max(1), Ordering::Release);
        // One not yet taken is replaced, and freed here, outside the lock.
        let unclaimed = self.pending_bank.lock().ok().and_then(|mut g| g.replace(bank));
        drop(unclaimed);
    }

    /// How many layers the bank the engine has been given was built for.
    pub fn bank_layers(&self) -> u32 {
        self.bank_layers.load(Ordering::Acquire)
    }

    /// Leave a freshly separated source for the audio thread to pick up.
    pub fn set_parts(&self, parts: Arc<fx::hstream::Parts>) {
        if let Ok(mut g) = self.parts_now.lock() {
            *g = Some(Arc::clone(&parts));
        }
        if let Ok(mut g) = self.pending_parts.lock() {
            *g = Some(parts);
        }
    }

    /// Leave a transient map for the audio thread to pick up.
    pub fn set_map(&self, map: Option<fx::transient::TimeMap>) {
        // Shared from here on, so the audio thread only ever moves a pointer.
        let map = map.map(Arc::new);
        let unclaimed = self.pending_map.lock().ok().and_then(|mut g| g.replace(map));
        drop(unclaimed);
    }

    pub fn set_rack(&self, rack: Option<fx::Rack>) {
        // A whole new chain supersedes any one slot still waiting to switch.
        let stale: Vec<_> = self.pending_swaps.lock().map(|mut g| g.drain(..).collect()).unwrap_or_default();
        drop(stale);
        self.collect();
        if let Ok(mut g) = self.manual.lock() {
            g.clear();
        }
        let mut rack = rack;
        if let Some(r) = rack.as_mut() {
            r.set_meters(Arc::clone(&self.rack_meters));
        }
        let unclaimed = self.pending_rack.lock().ok().and_then(|mut g| g.replace(rack));
        drop(unclaimed);
    }

    /// Switch one slot to a new effect, live, fading over 20 ms while the rest
    /// of the chain plays on (SUITE-PLAN §2.0: a mode switch). The effect is
    /// built by the caller, off the audio thread. Controls held for the slot
    /// by hand belong to the mode it is leaving, so they are let go.
    pub fn swap_slot(&self, slot: usize, effect: Box<dyn fx::Effect>) {
        if let Ok(mut g) = self.manual.lock() {
            g.retain(|(s, _, _)| *s != slot);
        }
        self.drop_retired();
        if let Ok(mut g) = self.pending_swaps.lock() {
            // A newer switch of the same slot wins over one not yet taken.
            if let Some(i) = g.iter().position(|(s, _)| *s == slot) {
                let old = g.swap_remove(i);
                drop(old);
            }
            if g.len() < g.capacity() {
                g.push((slot, effect));
            }
        }
    }

    // ---- The same changes, for a host that delivers them on its own audio
    // thread. Each leaves the new thing for the deck and hands back whatever
    // was still waiting there, so nothing is freed and nothing allocated.
    // The host must be the only one using these and the setters above.
    //
    // The sound and the parts are also read by the housekeeping thread
    // (`collect`, for the copies an octave up). Their two forms never wait
    // for it: if it holds the lock at that instant they hand the new thing
    // straight back (`Err`), for the host to offer again at its next block.

    /// [`Shared::set_params`]'s other form. The voice feeder reads the
    /// settings too, so this never waits for it: `false` means it was
    /// reading at that instant and the host should offer them again.
    pub fn put_params(&self, p: StreamParams) -> bool {
        match self.params.try_lock() {
            Ok(mut g) => {
                *g = p;
                true
            }
            Err(_) => false,
        }
    }

    /// [`Shared::set_source`]'s other form. Hands back the sound that was in
    /// the slot (which the deck may still be playing: it is a second hold).
    pub fn put_source(&self, s: Arc<Source>) -> Result<Arc<Source>, Arc<Source>> {
        // The copies an octave up were of the old sound. Cleared first, so a
        // miss on the second lock leaves nothing half done: copies cleared
        // early are only made again.
        if !self.octaves.try_clear() {
            return Err(s);
        }
        match self.source.try_lock() {
            Ok(mut g) => Ok(std::mem::replace(&mut *g, s)),
            Err(_) => Err(s),
        }
    }

    /// [`Shared::set_rack`]'s other form: `Ok(Some(unclaimed))` if a rack (or
    /// "no rack") was still waiting. It does not let go of controls held by
    /// hand or of slots waiting to switch; a host that uses those calls
    /// `set_rack` from its control thread instead. Like the sound's form it
    /// never waits: `Err` is the rack back, another thread being in the slot
    /// at that instant, for the host to offer again.
    #[allow(clippy::type_complexity)]
    pub fn put_rack(&self, mut rack: Option<fx::Rack>) -> Result<Option<Option<fx::Rack>>, Option<fx::Rack>> {
        let Some(mut g) = free(&self.pending_rack) else { return Err(rack) };
        if let Some(r) = rack.as_mut() {
            r.set_meters(Arc::clone(&self.rack_meters));
        }
        Ok(g.replace(rack))
    }

    /// [`Shared::set_bank`]'s other form. `Err` is the bank back, as for
    /// [`Shared::put_rack`].
    pub fn put_bank(
        &self,
        bank: crate::stretcher::LayerBank,
    ) -> Result<Option<crate::stretcher::LayerBank>, crate::stretcher::LayerBank> {
        let Some(mut g) = free(&self.pending_bank) else { return Err(bank) };
        self.bank_layers.store(bank.layers.max(1), Ordering::Release);
        Ok(g.replace(bank))
    }

    /// [`Shared::set_parts`]'s other form. Hands back two holds, either of
    /// which may be the last on its separation: the one kept for the copies
    /// an octave up, and one still waiting unclaimed.
    #[allow(clippy::type_complexity)]
    pub fn put_parts(
        &self,
        parts: Arc<fx::hstream::Parts>,
    ) -> Result<[Option<Arc<fx::hstream::Parts>>; 2], Arc<fx::hstream::Parts>> {
        let Ok(mut now) = self.parts_now.try_lock() else { return Err(parts) };
        let Ok(mut pending) = self.pending_parts.try_lock() else { return Err(parts) };
        let was = now.replace(Arc::clone(&parts));
        let unclaimed = pending.replace(parts);
        Ok([was, unclaimed])
    }

    /// [`Shared::set_map`]'s other form. The map comes already shared:
    /// sharing it is an allocation. `Err` is the map back, as for
    /// [`Shared::put_rack`].
    #[allow(clippy::type_complexity)]
    pub fn put_map(
        &self,
        map: Option<Arc<fx::transient::TimeMap>>,
    ) -> Result<Option<Option<Arc<fx::transient::TimeMap>>>, Option<Arc<fx::transient::TimeMap>>> {
        let Some(mut g) = free(&self.pending_map) else { return Err(map) };
        Ok(g.replace(map))
    }

    /// Free, here, everything the audio thread has finished with: sounds,
    /// racks, banks, maps, effects and voices it has replaced. Call it from
    /// any thread but the audio one, and keep calling it: the main deck's
    /// voice feeder does, and [`Shared::spawn_collector`] is a thread that
    /// does nothing else, for a deck with no feeder.
    pub fn collect(&self) {
        // Drained, not taken, so the list keeps its room for the callback;
        // and dropped outside the lock, so the callback is never kept from
        // the list while megabytes are freed.
        let gone: Vec<Retired> = self.retired.lock().map(|mut g| g.drain(..).collect()).unwrap_or_default();
        drop(gone);
        self.drop_retired();
        self.voices.collect();
        let parts = self.parts_now.lock().ok().and_then(|g| g.clone());
        self.octaves.tend(self.source(), parts);
    }

    /// A thread that frees what the audio thread hands back, a few times a
    /// second, for as long as the deck lasts.
    pub fn spawn_collector(shared: std::sync::Weak<Shared>) {
        let _ = std::thread::Builder::new().name("deck-collect".into()).spawn(move || loop {
            let Some(s) = shared.upgrade() else { break };
            s.collect();
            drop(s);
            std::thread::sleep(std::time::Duration::from_millis(50));
        });
    }

    /// Put something the audio thread has finished with on the list to be
    /// freed. Handed straight back if the list is busy or full: the caller
    /// keeps it and tries again.
    pub(crate) fn retire(&self, thing: Retired) -> Result<(), Retired> {
        match self.retired.try_lock() {
            Ok(mut g) if g.len() < g.capacity() => {
                g.push(thing);
                Ok(())
            }
            _ => Err(thing),
        }
    }

    /// Drop, here, what the audio thread has finished with.
    fn drop_retired(&self) {
        let gone: Vec<_> = self.retired_effects.lock().map(|mut g| g.drain(..).collect()).unwrap_or_default();
        drop(gone);
    }

    /// Move one control on one slot, live, without rebuilding anything.
    ///
    /// This is what a hand on a slider sends. Rebuilding the rack to change a
    /// number throws away every delay line, filter and reverb tail in the
    /// chain — which is audible as a click at best and as the tail vanishing at
    /// worst, and is why moving a control never felt connected to the sound.
    pub fn set_manual_param(&self, slot: usize, key: &str, value: f32) {
        if let Ok(mut g) = self.manual.lock() {
            match g.iter_mut().find(|(s, k, _)| *s == slot && k == key) {
                Some(entry) => entry.2 = value,
                None => g.push((slot, key.to_string(), value)),
            }
        }
    }

    /// Peak level either side of each slot: index 0 is the rack's input, index
    /// *n+1* the output of slot *n*.
    pub fn rack_levels(&self) -> Vec<(f32, f32)> {
        self.rack_meters.snapshot()
    }

    /// Each slot's own scalar — gain reduction for a compressor, zero for
    /// anything with nothing worth reporting.
    pub fn rack_telemetry(&self) -> Vec<f32> {
        self.rack_meters.telemetry_snapshot()
    }

    /// Drop the meters to silence. Called when playback stops, so a rail of
    /// meters falls rather than freezing at the last block that was heard.
    pub fn clear_rack_meters(&self) {
        self.rack_meters.clear();
    }

    /// Replace the automation writes the callback applies each block.
    ///
    /// Called from a control thread a hundred or so times a second. The vector
    /// and its strings are built here and dropped here; see
    /// [`Shared::automation`] for why that matters.
    pub fn set_automation(&self, values: Vec<(usize, String, f32)>) {
        if let Ok(mut g) = self.automation.lock() {
            *g = values;
        }
    }

    /// Stop applying automation — on stop, or when the last lane goes away.
    ///
    /// Without this the final values would stay written into the rack after
    /// playback ended, and the next thing to play would start under them.
    pub fn clear_automation(&self) {
        if let Ok(mut g) = self.automation.lock() {
            g.clear();
        }
    }

    /// What the callback is currently applying. For tests and diagnostics.
    pub fn automation_writes(&self) -> Vec<(usize, String, f32)> {
        self.automation.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn set_gain(&self, g: f32) {
        self.gain.store(g.clamp(0.0, 4.0).to_bits(), Ordering::Release);
    }

    /// The varispeed rate, 0 to 2. Out-of-range and non-finite values are held
    /// to the range rather than refused, so a slider can never stop the engine.
    pub fn set_speed(&self, rate: f32) {
        let rate = if rate.is_finite() { rate.clamp(0.0, MAX_SPEED) } else { 1.0 };
        self.speed.store(rate.to_bits(), Ordering::Release);
    }

    /// The left and right faders as linear gains. Non-finite or negative is
    /// unity, so a bad value can never silence a side.
    pub fn set_side_gains(&self, left: f32, right: f32) {
        let ok = |g: f32| if g.is_finite() && g >= 0.0 { g } else { 1.0 };
        self.gain_l.store(ok(left).to_bits(), Ordering::Release);
        self.gain_r.store(ok(right).to_bits(), Ordering::Release);
    }

    pub fn set_post_roll_frames(&self, frames: u64) {
        self.post_roll.store(frames, Ordering::Release);
    }

    pub fn post_roll_frames(&self) -> u64 {
        self.post_roll.load(Ordering::Acquire)
    }

    pub fn set_pitch_time(&self, p: PitchTime) {
        if let Ok(mut g) = self.pitch_time.lock() {
            *g = PitchTime {
                speed: if p.speed.is_finite() { p.speed.clamp(1.0, 200.0) } else { 100.0 },
                pitch: if p.pitch.is_finite() { p.pitch.clamp(0.0, 200.0) } else { 100.0 },
                ..p
            };
        }
    }

    pub fn pitch_time(&self) -> PitchTime {
        self.pitch_time.lock().map(|g| *g).unwrap_or_default()
    }

    pub fn side_gains(&self) -> (f32, f32) {
        (f32::from_bits(self.gain_l.load(Ordering::Acquire)), f32::from_bits(self.gain_r.load(Ordering::Acquire)))
    }

    pub fn speed(&self) -> f32 {
        f32::from_bits(self.speed.load(Ordering::Acquire))
    }

    /// Hyperprism's Smoothing (%) for Stretch and Pitch, from the HyperStretch
    /// pad. Zero, the default, is instant: every control behaves as it always
    /// has. See `glide.rs`.
    pub fn set_glide(&self, smoothing: f32) {
        let s = if smoothing.is_finite() { smoothing.clamp(0.0, 100.0) } else { 0.0 };
        self.glide.store(s.to_bits(), Ordering::Release);
    }

    pub fn glide(&self) -> f32 {
        f32::from_bits(self.glide.load(Ordering::Acquire))
    }

    pub fn set_mute(&self, m: bool) {
        self.mute.store(m, Ordering::Release);
    }

    pub fn muted(&self) -> bool {
        self.mute.load(Ordering::Acquire)
    }

    /// The master bus in time order, oldest first, with the rate it came out at.
    ///
    /// `None` until something has played. The ring is copied out under the lock
    /// and the caller does its arithmetic outside it — a 4096-point transform
    /// must never be holding a lock the audio thread is about to want. The copy
    /// itself is a 128 KB memcpy; the callback takes `try_lock` and skips a
    /// block rather than wait for it, which costs one block of scope data and
    /// nothing else.
    /// Copy a block of interleaved output into the master bus ring.
    ///
    /// `try_lock`: the audio thread skips a block rather than wait, which costs
    /// one block of meter data and never a deadline.
    pub fn push_scope(&self, out: &[f32], channels: usize, rate: u32) {
        if let Ok(mut g) = self.scope.try_lock() {
            g.write(out, channels, rate);
        }
    }

    pub fn scope_snapshot(&self) -> Option<(Vec<f32>, Vec<f32>, u32)> {
        self.scope.lock().ok()?.snapshot()
    }

    /// Ask for the block as it reaches the rack for this many more frames.
    pub fn want_pre_rack(&self, frames: u32) {
        self.pre_rack_left.store(frames, Ordering::Relaxed);
    }

    /// The last of what reached the rack, while it has been asked for. Oldest
    /// first, and in step with [`scope_snapshot`](Self::scope_snapshot).
    pub fn pre_rack_snapshot(&self) -> Option<(Vec<f32>, Vec<f32>, u32)> {
        self.pre_rack.lock().ok()?.snapshot()
    }

    /// The callback's half. When nobody has asked this is one relaxed load.
    pub(super) fn push_pre_rack(&self, out: &[f32], channels: usize, rate: u32) {
        let left = self.pre_rack_left.load(Ordering::Relaxed);
        if left == 0 {
            return;
        }
        let frames = (out.len() / channels.max(1)) as u32;
        // A compare, not a store: an ask landing here keeps its whole allowance.
        let _ = self.pre_rack_left.compare_exchange(left, left.saturating_sub(frames), Ordering::Relaxed, Ordering::Relaxed);
        if let Ok(mut g) = self.pre_rack.try_lock() {
            g.write(out, channels, rate);
        }
    }

    /// The output fader, 0 to 4.
    pub fn output_gain(&self) -> f32 {
        f32::from_bits(self.gain.load(Ordering::Acquire))
    }

    /// Drop the master bus to silence, so the meters fall when playback stops
    /// rather than freezing on the last block that was heard.
    pub fn clear_scope(&self) {
        if let Ok(mut g) = self.scope.lock() {
            g.l.fill(0.0);
            g.r.fill(0.0);
            g.at = 0;
            g.filled = false;
        }
    }

    pub fn spectrum(&self) -> Vec<u8> {
        self.spectrum.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn waveform(&self) -> Vec<i8> {
        self.waveform.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// Take the grains reported since the last call. The visualiser drains
    /// this; nothing else should.
    pub fn drain_events(&self) -> Vec<GrainEvent> {
        // The audio thread is left a list with its room already made, by
        // this thread: taking the list and leaving an empty one made the
        // callback allocate again after every visit.
        let mut list = Vec::with_capacity(EVENTS_ROOM);
        if let Ok(mut g) = self.events.lock() {
            std::mem::swap(&mut *g, &mut list);
        }
        list
    }

    /// `end` is the document's length under the current ratio, used when the
    /// caller asks to loop the whole thing.
    ///
    /// A loop end of zero means "all of it". The alternative is for the UI to
    /// work out the length itself and keep it in step with every ratio change,
    /// which it cannot reliably do — it guessed wrong, and playback ran past
    /// the end of a looping file.
    pub(super) fn loop_bounds(&self, end: u64) -> Option<(u64, u64)> {
        if !self.loop_on.load(Ordering::Acquire) {
            return None;
        }
        self.region_bounds(end)
    }

    /// The loop region, lit or not: what a held note goes round.
    pub(crate) fn region_bounds(&self, end: u64) -> Option<(u64, u64)> {
        let a = self.loop_a.load(Ordering::Acquire);
        let b = match self.loop_b.load(Ordering::Acquire) {
            0 => end,
            n => n.min(end.max(1)),
        };
        if b > a + MIN_LOOP_FRAMES {
            Some((a, b))
        } else {
            None
        }
    }
}
