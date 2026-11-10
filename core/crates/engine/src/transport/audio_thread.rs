//! The audio thread's side: `impl Core`, the block it renders.

use super::*;

impl Core {
    /// Point a control at a new value, without moving it yet.
    ///
    /// A control asked for something it is already at costs nothing; a new one
    /// starts from where it was asked to go rather than from zero, so the first
    /// write of a session lands immediately instead of sweeping up from silence.
    fn aim(&mut self, slot: usize, key: &str, value: f32) {
        if let Some(s) = self.smoothing.iter_mut().find(|s| s.is(slot, key)) {
            s.target = value;
            // A control that cannot meaningfully be halfway between two
            // settings jumps: see `is_stepped`.
            if is_stepped(key) {
                s.current = value;
            }
            return;
        }
        // First sight of this control. Start it from wherever the effect
        // actually is and ramp from there — writing it straight through was the
        // click, because the first move of any control is the one that matters.
        // An effect that cannot say where it is gets the value directly, which
        // is the old behaviour and the best that can be done for it.
        let from = self.rack.as_ref().and_then(|r| r.get_param(slot, key));
        if from.is_none() {
            if let Some(rack) = self.rack.as_mut() {
                rack.set_param(slot, key, value);
            }
        }
        let bytes = key.as_bytes();
        if self.smoothing.len() < MAX_SMOOTHED && bytes.len() <= 32 {
            let mut buf = [0u8; 32];
            buf[..bytes.len()].copy_from_slice(bytes);
            self.smoothing.push(Smoothed {
                slot,
                key: buf,
                key_len: bytes.len(),
                current: if is_stepped(key) { value } else { from.unwrap_or(value) },
                target: value,
            });
        }
    }

    /// Run the rack, nudging any travelling control as it goes.
    ///
    /// In one piece when nothing is moving, which is almost always; in short
    /// pieces while something is, so a control arrives as a slope rather than
    /// as an edge. See [`CONTROL_CHUNK`].
    fn process_rack(&mut self, out: &mut [f32], channels: usize, shared: &Shared) {
        // Before the chain, whether or not there is one: with no rack, before
        // and after are the same sound and should be drawn as the same sound.
        shared.push_pre_rack(out, channels, self.params.sample_rate);
        if self.rack.is_none() && self.leaving.is_none() {
            return;
        }
        let ch = channels.max(1);
        let sr = self.params.sample_rate;

        // The rack being left behind has to see the block as it arrived, and
        // the one arriving works in place — so keep a copy first.
        let fading = self.leaving.is_some() && self.rack_dry.len() >= out.len();
        if fading {
            self.rack_dry[..out.len()].copy_from_slice(out);
        }

        self.process_current(out, ch, sr);

        if !fading {
            return;
        }
        let frames = out.len() / ch;
        let mut dry = std::mem::take(&mut self.rack_dry);
        let mut done = false;
        if let Some((old, left)) = self.leaving.as_mut() {
            old.process(&mut dry[..out.len()], ch, sr);
            // Equal gain, not equal power. Two racks fed the same block are
            // two versions of one signal and largely in phase with each other,
            // so a root-two lift through the middle would be a bump rather
            // than a correction. This is the opposite call from switching
            // stretch engines, where the two agree about content and not at
            // all about phase.
            for f in 0..frames {
                let t = ((RACK_FADE_FRAMES - *left + f) as f32 / RACK_FADE_FRAMES as f32)
                    .clamp(0.0, 1.0);
                for c in 0..ch {
                    let i = f * ch + c;
                    out[i] = out[i] * t + dry[i] * (1.0 - t);
                }
            }
            *left = left.saturating_sub(frames);
            done = *left == 0;
        }
        self.rack_dry = dry;
        if done {
            self.leaving = None;
        }
    }

    /// The rack that is actually in the chain, smoothing as it goes.
    fn process_current(&mut self, out: &mut [f32], ch: usize, sr: u32) {
        if self.rack.is_none() {
            return;
        }
        let moving = self
            .smoothing
            .iter()
            .any(|s| (s.current - s.target).abs() > 1e-7);
        if !moving {
            if let Some(rack) = self.rack.as_mut() {
                rack.process(out, ch, sr);
            }
            return;
        }
        for chunk in out.chunks_mut(CONTROL_CHUNK * ch) {
            self.settle(chunk.len() / ch);
            if let Some(rack) = self.rack.as_mut() {
                rack.process(chunk, ch, sr);
            }
        }
    }

    /// Move every driven control one step closer to its target and write it.
    fn settle(&mut self, frames: usize) {
        if self.smoothing.is_empty() {
            return;
        }
        let sr = self.params.sample_rate.max(1) as f32;
        // One pole, per block. The block is short next to the time constant, so
        // treating the whole block as one step is inaudible and costs one
        // multiply per control rather than one per sample.
        let k = (1.0 - (-(frames as f32) / (SMOOTH_SECONDS * sr)).exp()).clamp(0.0, 1.0);
        let Some(rack) = self.rack.as_mut() else { return };
        for s in &mut self.smoothing {
            if (s.current - s.target).abs() < 1e-7 {
                continue;
            }
            s.current += (s.target - s.current) * k;
            // Land exactly rather than approaching forever, so a control that
            // has arrived stops costing anything.
            if (s.current - s.target).abs() < 1e-6 {
                s.current = s.target;
            }
            rack.set_param(s.slot, s.name(), s.current);
        }
    }

    /// `channels` is the *device's* channel count, not the source's.
    ///
    /// The engines size their buffers from it once and never again, so it has
    /// to be the width they will actually be asked to fill. Taking it from the
    /// source was wrong twice over: the source at build time is the silent
    /// placeholder, which is mono, and the source changes every time a file is
    /// opened while the device's width never does. A stereo file rendered into
    /// half its buffer and left the rest silent.
    pub fn new(
        max_block: usize,
        channels: usize,
        params: StreamParams,
        source: Arc<Source>,
    ) -> Self {
        Core {
            renderer: Stretcher::new(max_block, channels.max(1), params.sample_rate),
            rack: None,
            leaving: None,
            rack_dry: vec![0.0; max_block.max(1) * channels.max(1)],
            fft_in: vec![0.0; FFT_SIZE],
            fft_at: 0,
            fft_re: vec![0.0; FFT_SIZE],
            fft_im: vec![0.0; FFT_SIZE],
            fft_bins: vec![0; FFT_SIZE / 2 + 1],
            tail_left: tail_budget(params.sample_rate),
            params,
            source,
            // Capacity up front: `aim` runs in the callback and must never
            // grow this.
            smoothing: Vec::with_capacity(MAX_SMOOTHED),
            // A run is at least a frame, so a block has at most one per frame.
            seq_runs: Vec::with_capacity(max_block.max(1) + 1),
            seq_fade: 0,
            seq_fade_at: 0,
            // A block at the top speed reads two frames for each one out, plus
            // the one either side the interpolation needs.
            vs: vec![0.0; (max_block.max(1) * MAX_SPEED as usize + 4) * channels.max(1)],
            vs_frames: 0,
            vs_frac: 0.0,
            ptc: fx::prism::make("hp-pitch-shifter", params.sample_rate, channels.max(1), &[]),
            ptc_now: PitchTime::default(),
            ptc_glide: crate::glide::Glide::default(),
            target: params,
            glide: crate::glide::Glide::default(),
            post_left: None,
            fader_now: [1.0; 2],
            fader_to: [1.0; 2],
            fader_from: [1.0; 2],
            fader_step: FADER_RAMP,
            keys: crate::keys::KeyPlayer::new(Arc::new(crate::keys::GrainKeys::new())),
            poly: crate::voices::Poly::new(max_block, channels.max(1)),
            scratch: vec![
                GrainEvent {
                    index: 0,
                    out_frame: 0,
                    src_frame: 0.0,
                    size: 0,
                    rate: 1.0,
                    pitch_semis: 0.0,
                    voice: 0,
                };
                128
            ],
        }
    }

    /// Have this deck played by `keys` (`keys.rs`).
    pub fn with_keys(mut self, keys: Arc<crate::keys::GrainKeys>) -> Self {
        self.keys = crate::keys::KeyPlayer::new(keys);
        self
    }

    /// Fill one block. This is the whole audio callback, minus the device.
    ///
    /// Split out so the transport can be tested without a sound card — looping,
    /// seeking and stopping are exactly the things that are miserable to debug
    /// through a pair of speakers.
    pub fn fill(&mut self, out: &mut [f32], channels: usize, shared: &Shared) {
        self.fill_with(out, channels, shared, None);
    }

    /// [`fill`](Core::fill), with another deck's block added before the master
    /// ceiling.
    ///
    /// This is how the synth deck (`synth.rs`) reaches the output: summed in
    /// after this deck's own fader and the sequencer, and before the soft
    /// ceiling, the capture, the scope and the spectrum, so what is recorded
    /// and metered is everything that left. It is added on the stopped path as
    /// well, because the synth has no transport and plays whether or not this
    /// deck does. `extra` is interleaved at `channels`, block for block.
    pub fn fill_with(&mut self, out: &mut [f32], channels: usize, shared: &Shared, extra: Option<&[f32]>) {
        // What this block cost, against what it is worth. Two clock reads, both
        // from the vDSO on every platform this runs on — cheap next to a block
        // of DSP, and the only honest answer to "can this engine keep up",
        // which no test on another machine can give.
        let started = std::time::Instant::now();
        self.fill_inner(out, channels, shared, extra);
        let frames = out.len() / channels.max(1);
        if frames > 0 && self.params.sample_rate > 0 {
            let budget =
                std::time::Duration::from_secs_f64(frames as f64 / self.params.sample_rate as f64);
            shared.record_block_cost(started.elapsed(), budget);
        }
    }

    fn fill_inner(&mut self, out: &mut [f32], channels: usize, shared: &Shared, extra: Option<&[f32]>) {
        let channels = channels.max(1);

        // Pick up changes if they are free to take, otherwise carry on with
        // what we have. Never block the audio thread.
        if let Ok(g) = shared.params.try_lock() {
            self.target = *g;
        }
        // Stretch and Pitch move towards what was asked by Hyperprism's
        // smoothing, while playing; stopped, they are simply there.
        let before = self.params.ratio;
        self.params = self.target;
        let block_frames = out.len() / channels;
        if shared.is_playing() {
            let [r, st] = self.glide.advance(
                [self.target.ratio, self.target.semitones],
                block_frames,
                self.params.sample_rate,
                shared.glide(),
            );
            self.params.ratio = r;
            self.params.semitones = st;
        } else {
            self.glide.snap([self.target.ratio, self.target.semitones]);
        }
        // The keys, on top of what the document asks and never written back.
        let keyed = self.keys.begin(block_frames, self.params.sample_rate, self.renderer.position(), shared.is_playing(), &mut self.poly);
        let detune = self.keys.detune(block_frames, self.params.sample_rate);
        // What a voice is pitched from: the keys' own pitch is its own.
        let voiced = self.params.semitones;
        if detune != 0.0 {
            self.params.semitones = (self.params.semitones + detune).clamp(-48.0, 48.0);
        }
        {
            // A new stretch keeps the playhead on the same moment of the file
            // (RJ, 4 Nov 2026): the position is counted in output frames, so
            // under a new ratio the same count is somewhere else in the sound
            // and playback jumped. Rescaled about where it is, the file goes on
            // from the same place, faster or slower, like a record changing
            // speed without its pitch. Skipped when a seek is already on its
            // way, which says where to be outright.
            // The grains already sounding are carried across rather than
            // dropped (`Stretcher::rescale`), so a drag does not flutter.
            // Measured on what plays, after the glide, so a gliding stretch
            // keeps its place at every step too.
            let after = self.params.ratio;
            if before > 0.0 && after > 0.0 && (after - before).abs() > 1e-6
                && shared.seek.load(Ordering::Acquire) < 0
            {
                let here = self.renderer.position() as f64;
                let there = (here * after as f64 / before as f64).round().max(0.0) as u64;
                self.renderer.rescale(there, &self.params);
                self.keys.rescale_clock(after as f64 / before as f64);
                self.poly.rescale(after as f64 / before as f64, &self.params);
                self.vs_frames = 0;
                self.vs_frac = 0.0;
            }
        }
        // A Scan moved under a held note keeps the read where it is, the same
        // way (`brackets.rs`).
        if let Some(there) = self.keys.scan_moved(self.renderer.position(), &self.params) {
            self.renderer.rescale(there, &self.params);
            self.vs_frames = 0;
            self.vs_frac = 0.0;
        }
        self.poly.scan_moved(&self.params);
        // Read, never written into `self.params`. See `record_block_cost`.
        self.renderer.set_layer_cap(shared.layer_cap());
        // What is *actually* being rendered, which is the requested count under
        // the cap — not the requested count.
        //
        // This published the request, so the interface said "3 of 3" while two
        // were sounding, which is the program lying about its own settings. It
        // also fed the governor: shedding is measured from what is running, and
        // reading back an unchanging 3 made every further trigger shed again
        // from 3 rather than from 2.
        let running = self.renderer.live_layers(&self.params).max(1);
        shared
            .layers_running
            .store(running, std::sync::atomic::Ordering::Relaxed);
        if let Ok(g) = shared.source.try_lock() {
            if !Arc::ptr_eq(&self.source, &g) {
                self.source = Arc::clone(&g);
            }
        }

        if let Ok(mut g) = shared.pending_rack.try_lock() {
            if let Some(next) = g.take() {
                // Keep the old chain alive for the crossfade. It shares the
                // meter block with the new one, so it is silenced first —
                // two writers on the same needles is a flicker between two
                // different chains.
                if let Some(mut old) = self.rack.take() {
                    old.mute_meters();
                    self.leaving = Some((old, RACK_FADE_FRAMES));
                }
                self.rack = next;
            }
        }
        if let Ok(mut g) = shared.pending_map.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_map(next);
            }
        }
        if let Ok(mut g) = shared.pending_parts.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_parts(next);
            }
        }
        if let Ok(mut g) = shared.pending_bank.try_lock() {
            if let Some(next) = g.take() {
                self.renderer.set_bank(next);
            }
        }
        self.poly.pickup(shared, &self.keys, &self.params);
        self.poly.adopt(&self.renderer, shared);
        // Borrowed, never taken — see `Shared::automation`. A contended lock
        // means the writer is mid-update; the previous values are still
        // applied, so skipping a block loses nothing.
        // Aim the smoothers at whatever has been asked for. Manual first, then
        // automation, so a lane wins over a hand on the same control.
        if self.rack.is_some() {
            if let Ok(g) = shared.manual.try_lock() {
                for (slot, key, value) in g.iter() {
                    self.aim(*slot, key, *value);
                }
            }
            if let Ok(g) = shared.automation.try_lock() {
                for (slot, key, value) in g.iter() {
                    self.aim(*slot, key, *value);
                }
            }
        }

        let seek = shared.seek.swap(-1, Ordering::AcqRel);
        if seek >= 0 {
            if self.keys.clocked() {
                // The head is a note's; the transport is told where to be.
                self.keys.set_clock(seek as u64);
            } else {
                self.renderer.seek(seek as u64, &self.params);
                // What was read ahead belongs to where the playhead was.
                self.vs_frames = 0;
                self.vs_frac = 0.0;
            }
        }
        let keyed_to = if keyed.resume {
            Some(self.keys.clock())
        } else if keyed.restart {
            Some(crate::brackets::frame(self.keys.start_frame(self.params.plan().out_frames as u64), &self.params))
        } else {
            None
        };
        if let Some(frame) = keyed_to {
            self.renderer.seek(frame, &self.params);
            self.vs_frames = 0;
            self.vs_frac = 0.0;
        }

        let poly = self.poly.active();
        if !shared.is_playing() && !self.keys.head_running() && !poly {
            // No *new* material — but the chain is not empty. A reverb that
            // stops dead on the same sample as the transport is the one thing
            // every listener notices, so the rack keeps running on silence and
            // its tails ring out.
            out.fill(0.0);
            if self.tail_left > 0 {
                self.process_rack(out, channels, shared);
                let peak = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
                // Counted down rather than stopped at the first quiet block:
                // a delay with a long gap between repeats is silent in the
                // middle and would be cut off by a single-block test.
                if peak < TAIL_SILENCE {
                    self.tail_left = self.tail_left.saturating_sub((out.len() / channels.max(1)) as u64);
                } else {
                    self.tail_left = tail_budget(self.params.sample_rate);
                }
            } else {
                // Long since quiet. Stop processing rather than burning a core
                // on silence for as long as the app is open.
                shared.rack_meters.clear();
            }
            // The stopped path returns here, so without this the master bus
            // would freeze on the last block that was heard and the meters
            // would hang at whatever they happened to be showing.
            //
            // A ringing tail is real audio leaving the bus and belongs on the
            // meters; after it, `out` is silence, and writing that drains the
            // ring so the meters fall the way a meter should. It is a four
            // kilobyte copy per block — the "burning a core" this branch avoids
            // was a rack full of reverbs, not a memcpy.
            // The sequencer fades out from where the transport stopped, over a
            // few milliseconds of what it had already sent, rather than stopping
            // dead mid-note.
            let mut sounding = false;
            if self.seq_fade > 0 && shared.seq.is_active() {
                let ch = channels.max(1);
                let n = (out.len() / ch).min(self.seq_fade);
                for i in 0..n {
                    if let Some((l, r)) = shared.seq.take(self.seq_fade_at + i as u64) {
                        let g = (self.seq_fade - i) as f32 / SEQ_STOP_FADE_FRAMES as f32;
                        add_frame(out, i * ch, ch, l * g, r * g);
                    }
                }
                self.seq_fade -= n;
                self.seq_fade_at += n as u64;
                sounding = true;
            }
            // The synth deck has no transport, so a stopped grain deck is no
            // reason for it to be silent. It goes through the same ceiling,
            // capture, scope and spectrum here as on the playing path below.
            match extra {
                Some(x) => self.finish_with(out, channels, shared, x),
                None => {
                    if sounding {
                        fx::soften(out);
                    }
                    shared.push_scope(out, channels, self.params.sample_rate);
                    // The waveform and spectrum too, for as long as a tail can
                    // ring: otherwise they hold the last block of a note or a
                    // stop for good. Past that they have settled on silence.
                    if self.tail_left > 0 {
                        self.measure(out, channels, shared);
                    }
                }
            }
            self.keys.end(self.renderer.position(), block_frames, false, None, false);
            self.poly.end_block(shared, block_frames, self.params.sample_rate, &self.params);
            shared
                .position
                .store(self.keys.transport(self.renderer.position()), Ordering::Release);
            return;
        }
        // Playing again: whatever is in the chain is live material, so the tail
        // budget is whole again the moment it is needed.
        self.tail_left = tail_budget(self.params.sample_rate);

        let frames = out.len() / channels;
        let end = self.params.plan().out_frames as u64;
        let bounds = self.keys.transport_bounds(shared.loop_bounds(end), &self.params);
        // Publish what was resolved, so a playhead somewhere else can wrap at
        // the same place rather than run past it and be dragged back.
        match bounds {
            Some((a, b)) => {
                shared.heard_a.store(a, Ordering::Release);
                shared.heard_b.store(b, Ordering::Release);
            }
            None => shared.heard_b.store(0, Ordering::Release),
        }

        // Not looping and past the end: stop. The engine has no end of its own
        // — a grain stream is happy to run forever, reading the clamped last
        // sample — so the end has to come from the schedule, which knows how
        // long the current ratio makes the document.
        //
        // Hyperprism's Post-Roll first: past the end, the transport plays on for
        // that long with the rack running on silence, so tails reach the end
        // of a take. Looping has none, as in the original.
        //
        // With Run off the renderer is a note's head and loops the region, so
        // the end only stops the transport's own count.
        let mut post = false;
        let clocked = self.keys.clocked();
        if clocked {
            if shared.is_playing() && bounds.is_none() && end > 0 && self.keys.clock() >= end {
                shared.pause();
            }
        } else if bounds.is_none() && end > 0 && self.renderer.position() >= end {
            let left = *self.post_left.get_or_insert(shared.post_roll_frames());
            if left == 0 && poly {
                // The transport has finished; the notes have not.
                self.post_left = None;
                shared.pause();
                post = true;
            } else if left == 0 {
                self.post_left = None;
                shared.pause();
                out.fill(0.0);
                // The block the transport stops on still carries the synth.
                if let Some(x) = extra {
                    self.finish_with(out, channels, shared, x);
                }
                shared
                    .position
                    .store(self.renderer.position(), Ordering::Release);
                return;
            } else {
                post = true;
                self.post_left = Some(left.saturating_sub(frames as u64));
            }
        } else {
            self.post_left = None;
        }

        // A held note loops the region whether or not the loop light is on; a
        // transport with no note under it renders nothing.
        let transport_bounds = bounds;
        let head_running = self.keys.head_running();
        let bounds = if head_running {
            shared.region_bounds(end).map(|x| crate::brackets::bounds(x, &self.params))
        } else {
            bounds
        };
        let gated = (clocked && !head_running) || (post && poly);
        // Poly's own loop is the region, as a held note's is.
        let voice_bounds = shared.region_bounds(end).map(|x| crate::brackets::bounds(x, &self.params));
        let mut poly_doc = self.params;
        poly_doc.semitones = voiced;
        self.poly.begin(&self.keys, &poly_doc, voice_bounds, shared, head_running);

        // Wrap first if we are already at or past the loop end, so a loop set
        // behind the playhead takes effect immediately.
        if let (Some((a, b)), false) = (bounds, gated) {
            if self.renderer.position() >= b || self.renderer.position() < a {
                self.renderer.seek(a, &self.params);
            }
        }

        // The seam fade, sized to this loop. Both sides of the wrap use it, so
        // it is resolved once rather than per chunk — and so the ramp down and
        // the ramp up are always the same length.
        let seam = bounds.map_or(LOOP_FADE_FRAMES, |(a, b)| loop_fade(a, b));

        if (post || gated) && !poly {
            out.fill(0.0);
            self.seq_runs.clear();
        } else {
            // Hyperprism's Playback Speed: the engine's output is read at `speed`
            // frames a frame, in straight lines between frames, before the rack —
            // varispeed, so pitch and time move together. The frames it reads are
            // rendered into `vs` first, as many as this block reaches into; what it
            // has not read past yet stays there for the next block. At speed 1 with
            // nothing held over, that is exactly the block the engine renders.
            // The Pitch Time Changer sets the read rate itself, as the original's
            // shifter set its file reader's.
            let pt = match shared.pitch_time.try_lock() {
                Ok(g) => *g,
                Err(_) => self.ptc_now,
            };
            // Speed and Pitch glide separately, as the original's did: the
            // reader takes the smoothed Speed, and the shifter corrects by the
            // smoothed Pitch over it, so the two never come apart.
            let (ptc_speed, ptc_pitch) = ptc_glided(&mut self.ptc_glide, &pt, self.ptc_now.on, frames, self.params.sample_rate);
            let speed = if pt.on { ptc_speed as f64 / 100.0 } else { 1.0 } * shared.speed() as f64;
            let ch = channels;
            let reach = self.vs_frac + (frames.saturating_sub(1)) as f64 * speed;
            let mut need = reach.floor() as usize + 1;
            if reach.fract() > 0.0 {
                need += 1;
            }
            let consumed = (self.vs_frac + frames as f64 * speed).floor() as usize;
            let need = need.max(consumed).min(self.vs.len() / ch);
            let fresh = need.saturating_sub(self.vs_frames);
            let base = self.vs_frames;

            let mut filled = 0usize;
            // Where in this block fresh post-wrap material begins, if it does.
            let mut wrapped_at: Option<usize> = None;
            self.seq_runs.clear();
            while filled < fresh {
                let want = fresh - filled;
                // Never render past the loop end in one go: the wrap has to land on
                // an exact frame or the loop drifts.
                let chunk = match bounds.filter(|_| !gated) {
                    Some((_, b)) => {
                        let room = b.saturating_sub(self.renderer.position()) as usize;
                        want.min(room.max(1))
                    }
                    None => want,
                };

                if self.seq_runs.len() < self.seq_runs.capacity() {
                    // The sequencer is stamped by output frame; under a speed other
                    // than 1 its runs land where the read reaches them.
                    let at = (((base + filled) as f64 - self.vs_frac) / speed.max(1e-9)).max(0.0) as usize;
                    self.seq_runs.push((at.min(frames), self.renderer.position(), chunk));
                }
                let slice = &mut self.vs[(base + filled) * ch..(base + filled + chunk) * ch];
                let n = if poly {
                    let span = speed as f32;
                    self.poly.render(chunk, &self.source, &poly_doc, &self.keys, voice_bounds, shared, &mut self.scratch, span);
                    if gated {
                        // Nothing but the notes: the deck's feedback is all
                        // that is left of its usual block.
                        slice.copy_from_slice(self.poly.mix(chunk * ch));
                        self.renderer.feedback_only(slice, ch, &self.params);
                        0
                    } else {
                        self.renderer.render_with(slice, ch, &self.source, &self.params, &mut self.scratch, Some(self.poly.mix(chunk * ch)))
                    }
                } else {
                    self.renderer.render(slice, ch, &self.source, &self.params, &mut self.scratch)
                };
                report(shared, &self.scratch[..n]);

                if let Some((a, b)) = bounds.filter(|_| !gated) {
                    if self.renderer.position() >= b {
                        // Fade the tail of what we just wrote, then jump. One
                        // source, so this is a fade across the seam rather than an
                        // overlap of two copies.
                        fade_out(slice, ch, seam);
                        self.renderer.seek(a, &self.params);
                        wrapped_at = Some(base + filled + chunk);
                    }
                }
                filled += chunk;
            }
            self.vs_frames = base + fresh;

            // Ramp the material that came after the jump — and only that. Ramping
            // every block would put an amplitude wobble at the block rate on
            // everything.
            if let Some(start) = wrapped_at {
                if start < self.vs_frames {
                    fade_in(&mut self.vs[start * ch..self.vs_frames * ch], ch, seam);
                }
            }

            // Read the block out of what was rendered.
            let last = self.vs_frames.saturating_sub(1);
            for f in 0..frames {
                let x = self.vs_frac + f as f64 * speed;
                let i = (x.floor() as usize).min(last);
                let t = (x - x.floor()) as f32;
                let j = (i + 1).min(last);
                for c in 0..ch {
                    let a = self.vs[i * ch + c];
                    out[f * ch + c] = if t == 0.0 { a } else { a + (self.vs[j * ch + c] - a) * t };
                }
            }
            // The Pitch Time Changer's shifter, on what the read produced, at the
            // ratio that puts the pitch back where its Pitch says.
            if pt.on {
                if let Some(shifter) = self.ptc.as_mut() {
                    if !self.ptc_now.on {
                        shifter.reset();
                    }
                    // The smoothing is done here, on Speed and Pitch; the
                    // shifter takes the ratio between them as it stands.
                    ptc_set_ratio(shifter.as_mut(), ptc_ratio(ptc_speed, ptc_pitch));
                    if pt != self.ptc_now || !self.ptc_now.on {
                        shifter.set_param("mix", 100.0);
                        shifter.set_param("feedback", pt.feedback);
                        shifter.set_param("grain", pt.grain);
                        shifter.set_param("xfade", pt.xfade);
                        shifter.set_param("smoothing", 0.0);
                    }
                    shifter.process(out, ch, self.params.sample_rate);
                }
            }
            self.ptc_now = pt;

            // Drop what the read has passed; keep the rest for the next block.
            let after = self.vs_frac + frames as f64 * speed;
            let drop = (after.floor() as usize).min(self.vs_frames);
            self.vs.copy_within(drop * ch..self.vs_frames * ch, 0);
            self.vs_frames -= drop;
            self.vs_frac = after - drop as f64;
        }

        // AMP, on what the engine made and before the rack, so the effects'
        // tails ring on after a release.
        if !(gated && poly) {
            self.keys.gate(out, channels, self.params.sample_rate);
        }
        if clocked {
            // The sequencer plays on the transport, not on a note's head.
            self.seq_runs.clear();
            if shared.is_playing() {
                let at = self.keys.clock();
                let first = match transport_bounds {
                    Some((_, b)) if b > at => frames.min((b - at) as usize),
                    _ => frames,
                };
                self.seq_runs.push((0, at, first));
                if first < frames {
                    if let Some((a, _)) = transport_bounds {
                        self.seq_runs.push((first, a, frames - first));
                    }
                }
            }
        }

        // The rack runs on the block, after the grains and before the fader,
        // exactly as the offline render orders it.
        self.process_rack(out, channels, shared);


        let gain = if shared.mute.load(Ordering::Acquire) {
            0.0
        } else {
            f32::from_bits(shared.gain.load(Ordering::Acquire))
        };
        if (gain - 1.0).abs() > 1e-6 {
            for s in out.iter_mut() {
                *s *= gain;
            }
        }
        // Hyperprism's L and R faders, on the two sides of a stereo bus. A mono
        // bus takes the left one.
        // A new setting starts a straight ramp from where the fader is, over
        // Hyperprism's 1024 frames.
        let (gl, gr) = shared.side_gains();
        if [gl, gr] != self.fader_to {
            self.fader_from = self.fader_now;
            self.fader_to = [gl, gr];
            self.fader_step = 0;
        }
        let still = self.fader_step >= FADER_RAMP;
        if !(still && (self.fader_now[0] - 1.0).abs() < 1e-7 && (self.fader_now[1] - 1.0).abs() < 1e-7) {
            for frame in out.chunks_mut(channels) {
                if self.fader_step < FADER_RAMP {
                    self.fader_step += 1;
                    let t = self.fader_step as f32 / FADER_RAMP as f32;
                    for side in 0..2 {
                        self.fader_now[side] = self.fader_from[side] + (self.fader_to[side] - self.fader_from[side]) * t;
                    }
                }
                frame[0] *= self.fader_now[0];
                if let Some(r) = frame.get_mut(1) {
                    *r *= self.fader_now[1];
                }
            }
        }

        // The sequencer, on the frames the grain was just rendered at. After the
        // grain's own gain, so GRAIN off silences the grain and not it, and
        // before the ceiling, the capture and the meters, so what is recorded
        // and drawn is both voices.
        self.mix_seq(out, channels, shared);

        // The synth deck, beside the sequencer and for the same reason: before
        // the ceiling, the capture and the meters. After this deck's fader, so
        // GRAIN's volume is the grain's and not the synth's.
        if let Some(x) = extra {
            add_block(out, x);
        }

        // The last thing before it leaves: round the peaks rather than let the
        // converter slice them.
        //
        // A rack can drive the channel a long way over — the "Breaking Again"
        // preset reaches +10.3 dBFS through a +16 dB shelf and a compressor with
        // makeup, with its own limiter switched off — and everything past full
        // scale arrives at the device as a hard corner. Below −3 dBFS this
        // changes nothing whatsoever, so it cannot colour a mix that was not
        // already too loud.
        //
        // After the fader, so pulling the volume down really does get you out of
        // it, and before the capture and the meters, so what is recorded and what
        // is displayed are what actually left.
        fx::soften(out);

        // Keep a copy, if anyone asked. Last, so what lands on disk is what
        // came out of the speakers rather than some earlier stage of it.
        capture_block(out, shared);

        // The master bus, kept in stereo. A copy and nothing more — see
        // [`Scope`] for why the analysis is not done here.
        shared.push_scope(out, channels, self.params.sample_rate);

        self.measure(out, channels, shared);

        self.keys.end(self.renderer.position(), frames, shared.is_playing(), transport_bounds, poly);
        self.poly.end_block(shared, frames, self.params.sample_rate, &self.params);
        shared
            .position
            .store(self.keys.transport(self.renderer.position()), Ordering::Release);
        shared
            .overflows
            .store(self.renderer.overflows(), Ordering::Release);
    }

    /// The end of a block the grain deck did not play: the synth deck's block
    /// added, then the ceiling, the capture, the scope and the spectrum, in
    /// the playing path's order.
    ///
    /// The capture runs here too, so a capture armed while the transport is
    /// stopped keeps time with the clock on the wall: the synth's notes and
    /// the silences between them, as they were heard.
    fn finish_with(&mut self, out: &mut [f32], channels: usize, shared: &Shared, extra: &[f32]) {
        add_block(out, extra);
        fx::soften(out);
        capture_block(out, shared);
        shared.push_scope(out, channels, self.params.sample_rate);
        self.measure(out, channels, shared);
    }

    /// Add the sequencer's sound for this block's runs, taking each frame off
    /// the bus at the output frame it was stamped for.
    fn mix_seq(&mut self, out: &mut [f32], channels: usize, shared: &Shared) {
        let bus = &shared.seq;
        if !bus.is_active() {
            self.seq_fade = 0;
            return;
        }
        let ch = channels.max(1);
        let (mut found, mut lost) = (0u64, 0u64);
        for &(offset, at, frames) in self.seq_runs.iter() {
            for i in 0..frames {
                match bus.take(at + i as u64) {
                    Some((l, r)) => {
                        add_frame(out, (offset + i) * ch, ch, l, r);
                        found += 1;
                    }
                    None => lost += 1,
                }
            }
        }
        bus.mixed.fetch_add(found, Ordering::Relaxed);
        bus.missing.fetch_add(lost, Ordering::Relaxed);
        // Where a stop would fade from.
        self.seq_fade = SEQ_STOP_FADE_FRAMES;
        self.seq_fade_at = self.keys.transport(self.renderer.position());
    }

    /// Feed the block into the spectrum window and publish a frame each time it
    /// fills. Allocation-free: every buffer here was sized once, at build.
    fn measure(&mut self, out: &[f32], channels: usize, shared: &Shared) {
        let frames = out.len() / channels.max(1);
        for f in 0..frames {
            let mut sum = 0.0;
            for ch in 0..channels {
                sum += out[f * channels + ch];
            }
            self.fft_in[self.fft_at] = sum / channels as f32;
            self.fft_at += 1;
            if self.fft_at < FFT_SIZE {
                continue;
            }
            self.fft_at = 0;

            for i in 0..FFT_SIZE {
                let w = 0.5
                    - 0.5
                        * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos();
                self.fft_re[i] = self.fft_in[i] * w;
                self.fft_im[i] = 0.0;
            }
            audio_core::fft::fft(&mut self.fft_re, &mut self.fft_im);

            // dB, mapped to the 0..255 the visualiser already speaks.
            for i in 0..self.fft_bins.len() {
                let m = (self.fft_re[i] * self.fft_re[i] + self.fft_im[i] * self.fft_im[i]).sqrt()
                    / (FFT_SIZE as f32 / 4.0);
                let db = 20.0 * m.max(1e-7).log10();
                let v = ((db + 90.0) / 90.0 * 255.0).clamp(0.0, 255.0);
                self.fft_bins[i] = v as u8;
            }
            if let Ok(mut g) = shared.spectrum.try_lock() {
                g.clear();
                g.extend_from_slice(&self.fft_bins);
            }
            // The same window, reduced to one peak per column. Peak rather than
            // an average: a compressor is reacting to the peaks, so an average
            // would draw a signal that never reaches the threshold the display
            // is drawing across it.
            if let Ok(mut g) = shared.waveform.try_lock() {
                g.clear();
                let step = FFT_SIZE / WAVE_POINTS;
                for i in 0..WAVE_POINTS {
                    let mut peak = 0.0f32;
                    for s in &self.fft_in[i * step..(i + 1) * step] {
                        if s.abs() > peak.abs() {
                            peak = *s;
                        }
                    }
                    g.push((peak.clamp(-1.0, 1.0) * 127.0) as i8);
                }
            }
        }
    }
}
