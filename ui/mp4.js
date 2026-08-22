// An MP4 muxer, written here.
//
// The browser will encode H.264 and AAC for us — `VideoEncoder` and
// `AudioEncoder` are in it already — but neither hands back a file. They hand
// back encoded chunks, and what turns chunks into something a player will open
// is a container. This is that container. See `docs/VIDEO-EXPORT.md`.
//
// **Fragmented MP4**, not progressive. A progressive file has to declare every
// sample's size and position in one table at the front, which means holding the
// whole render before a byte can be written and rewriting the header when the
// count changes. A fragmented file states each run of samples immediately
// before it. The tables are small, local, and correct as they are written —
// there is no moment where the header disagrees with the payload. Every player
// that matters has opened these for a decade; it is what streaming is made of.
//
// The project already wrote its own HTTP, its own JSON and its own WebGL, so a
// few hundred lines of box writing is in character rather than heroic.

/// A growable buffer with the writes an MP4 is made of.
///
/// Big-endian throughout, because that is what the format is — "network byte
/// order" in a spec written when that phrase was current.
class Mp4Writer {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.at = 0;
  }

  room(n) {
    if (this.at + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.at + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.at));
    this.buf = next;
  }

  u8(v) { this.room(1); this.buf[this.at++] = v & 0xff; return this; }
  u16(v) { return this.u8(v >>> 8).u8(v); }
  u24(v) { return this.u8(v >>> 16).u8(v >>> 8).u8(v); }

  /// **Unsigned shifts, and it matters.** A signed `>>` in JavaScript converts
  /// to a 32-bit *signed* integer first, so anything at or above 2^31 comes out
  /// negative and every byte after it is wrong. An audio sample rate written as
  /// 16.16 fixed point is exactly that: 48000 × 65536 is 3,145,728,000, and
  /// `48000 << 16` is −1,149,239,296. The file that came out of that had a
  /// sample entry no parser would accept, and it failed silently — the boxes
  /// all had sane lengths, so it looked well formed and simply would not open.
  u32(v) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }

  /// 16.16 fixed point, without going near a shift.
  fixed(v) { return this.u32(Math.round(v * 65536)); }

  /// 64-bit, written as two 32-bit halves because a bitwise shift in JavaScript
  /// is a 32-bit operation and would silently wrap.
  u64(v) {
    const hi = Math.floor(v / 4294967296);
    return this.u32(hi).u32(v >>> 0);
  }

  str(s) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }

  bytes(b) {
    this.room(b.length);
    this.buf.set(b, this.at);
    this.at += b.length;
    return this;
  }

  /// A box: its own length, its name, then whatever the body writes.
  ///
  /// The length is patched in afterwards rather than counted in advance —
  /// counting it in advance is the same arithmetic done twice, in two places,
  /// with only one of them checked by anything.
  box(name, body) {
    const start = this.at;
    this.u32(0).str(name);
    body(this);
    const end = this.at;
    const len = end - start;
    this.buf[start] = (len >>> 24) & 0xff;
    this.buf[start + 1] = (len >>> 16) & 0xff;
    this.buf[start + 2] = (len >>> 8) & 0xff;
    this.buf[start + 3] = len & 0xff;
    return this;
  }

  /// A box that begins with a version and flags, which most of them do.
  full(name, version, flags, body) {
    return this.box(name, (w) => {
      w.u8(version).u24(flags);
      body(w);
    });
  }

  done() {
    return this.buf.subarray(0, this.at);
  }
}

/// One track's worth of samples waiting to be written into a fragment.
class Mp4Track {
  constructor(id, kind, timescale) {
    this.id = id;
    this.kind = kind;              // 'video' | 'audio'
    this.timescale = timescale;
    this.samples = [];
    /// Where this track has got to, in its own timescale. `tfdt` needs it and
    /// getting it wrong is how audio drifts away from picture over minutes.
    this.at = 0;
    this.description = null;       // avcC or AudioSpecificConfig
    this.width = 0;
    this.height = 0;
    this.channels = 0;
    this.rate = 0;
  }
}

/// Turn encoded chunks into an MP4.
///
/// Both tracks are written into the same fragments, so the file interleaves
/// rather than holding all the video and then all the sound. A player that
/// starts before it has the whole file — which is any player, over a `blob:`
/// URL — needs the audio for a moment to be near the picture for that moment.
class Mp4Muxer {
  /// `video` is `{width, height, fps}` and `audio` is `{rate, channels}`.
  /// Either may be null, though a file with neither is not a file.
  constructor({ video = null, audio = null, fragmentSeconds = 1,
    durationSeconds = 0 } = {}) {
    this.tracks = [];
    // The movie's own clock. A thousand ticks a millisecond is plenty and is
    // what every muxer picks, so durations land on whole numbers.
    this.timescale = 1000;
    this.video = null;
    this.audio = null;
    if (video) {
      // The video track counts in frames-per-second times a thousand, so a
      // frame of 30fps material is an exact number of ticks rather than a
      // recurring one. 29.97 is not offered, so nothing here has to round.
      this.video = new Mp4Track(this.tracks.length + 1, 'video', video.fps * 1000);
      this.video.width = video.width;
      this.video.height = video.height;
      this.tracks.push(this.video);
    }
    if (audio) {
      // Audio counts in samples. Anything else would put a rounding error
      // between the two streams that grows for the length of the file.
      this.audio = new Mp4Track(this.tracks.length + 1, 'audio', audio.rate);
      this.audio.rate = audio.rate;
      this.audio.channels = audio.channels;
      this.tracks.push(this.audio);
    }
    this.fragmentSeconds = fragmentSeconds;
    // How long the whole thing will be. A fragmented file's `mvhd` cannot say —
    // it does not know yet — so `mehd` says it instead, and without one a
    // player has to read every fragment before it can tell you a duration or
    // draw a scrub bar. Some do. Some just report nothing.
    this.durationSeconds = durationSeconds;
    this.parts = [];
    this.sequence = 1;
    this.started = false;
    /// What each fragment turned out to be once written — bytes, span, and
    /// whether it opens on a keyframe. None of it is known until the fragment
    /// is built, and `sidx` needs all of it at once. See `index`.
    this.fragments = [];
  }

  /// Hand a chunk over, with the metadata the encoder gave alongside it.
  add(kind, chunk, meta) {
    const track = kind === 'video' ? this.video : this.audio;
    if (!track) return;
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !track.description) {
      track.description = new Uint8Array(meta.decoderConfig.description);
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    // Chunk times are microseconds; the track counts in its own timescale.
    const us = (v) => Math.round((v / 1e6) * track.timescale);
    track.samples.push({
      data,
      duration: chunk.duration ? us(chunk.duration) : 0,
      time: us(chunk.timestamp),
      sync: chunk.type === 'key',
    });
  }

  /// Cut everything held into fragments, at the end.
  ///
  /// **Not as the samples arrive.** This used to write a fragment as soon as
  /// every track had a second in hand — right for a muxer being fed both
  /// streams together, and wrong for this one. The film is drawn and encoded in
  /// full, and only then is the sound. So for the whole of the video pass the
  /// audio track held nothing, "every track has enough" was never true, and not
  /// one fragment was written: the entire film ended up in a single `moof` with
  /// the sound stapled on the end.
  ///
  /// A file like that plays perfectly and cannot be scrubbed. With one fragment
  /// there is one place a seek can land, and it is the beginning — which is
  /// what every seek into a fifteen-second export did.
  ///
  /// Cutting at the end costs nothing, because all of it is in memory either
  /// way, and it can cut where it wants to: on keyframes, so every fragment
  /// opens on a picture that needs nothing before it.
  cutFragments() {
    const held = this.tracks.map((t) => ({ t, s: t.samples.splice(0) }));
    if (!held.some((x) => x.s.length)) return;
    if (!this.started) {
      this.parts.push(this.header());
      this.started = true;
    }
    const v = this.video;
    const vid = held.find((x) => x.t === v);
    // Sound with no picture is one fragment and nothing to align to.
    if (!vid || !vid.s.length) {
      for (const x of held) x.t.samples = x.s;
      this.parts.push(this.fragment());
      return;
    }

    // Where each track's samples begin, in its own ticks, so the sound can be
    // cut at the same instants as the picture despite counting differently.
    const starts = new Map();
    for (const x of held) {
      const acc = new Float64Array(x.s.length + 1);
      for (let i = 0; i < x.s.length; i++) acc[i + 1] = acc[i] + x.s[i].duration;
      starts.set(x.t, acc);
    }

    // Cut on a keyframe, but no more often than asked for.
    const vAcc = starts.get(v);
    const want = this.fragmentSeconds * v.timescale;
    const bounds = [];
    let lastCut = 0;
    for (let i = 1; i < vid.s.length; i++) {
      if (vid.s[i].sync && vAcc[i] - lastCut >= want) {
        bounds.push(i);
        lastCut = vAcc[i];
      }
    }
    bounds.push(vid.s.length);

    const cursor = new Map(held.map((x) => [x.t, 0]));
    let from = 0;
    for (const to of bounds) {
      const until = vAcc[to] / v.timescale;
      for (const x of held) {
        if (x.t === v) { x.t.samples = x.s.slice(from, to); continue; }
        const acc = starts.get(x.t);
        const k = cursor.get(x.t);
        // Up to the same moment — and the last fragment takes whatever is left,
        // so nothing is dropped to a rounding error.
        let end = k;
        if (to === vid.s.length) end = x.s.length;
        else while (end < x.s.length && acc[end] / x.t.timescale < until) end++;
        x.t.samples = x.s.slice(k, end);
        cursor.set(x.t, end);
      }
      this.parts.push(this.fragment());
      from = to;
    }
  }

  /// `ftyp` and `moov`: what the file is, and what is in it.
  header() {
    const w = new Mp4Writer();
    w.box('ftyp', (b) => {
      b.str('isom').u32(0x200).str('isom').str('iso2').str('avc1').str('mp41');
    });
    w.box('moov', (b) => {
      b.full('mvhd', 0, 0, (m) => {
        m.u32(0).u32(0).u32(this.timescale)
          // Zero, because a fragmented file does not know its length yet and
          // saying a number here that the fragments then contradict is worse
          // than saying nothing.
          .u32(0)
          .u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0);
        for (const v of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) m.u32(v);
        for (let i = 0; i < 6; i++) m.u32(0);
        m.u32(this.tracks.length + 1);
      });
      for (const t of this.tracks) this.trak(b, t);
      b.box('mvex', (mv) => {
        if (this.durationSeconds > 0) {
          mv.full('mehd', 1, 0, (m) => {
            m.u64(Math.round(this.durationSeconds * this.timescale));
          });
        }
        for (const t of this.tracks) {
          mv.full('trex', 0, 0, (x) => {
            x.u32(t.id).u32(1).u32(0).u32(0).u32(0);
          });
        }
      });
    });
    return w.done();
  }

  trak(b, t) {
    b.box('trak', (tr) => {
      // Flags 3: this track is enabled and is in the movie.
      tr.full('tkhd', 0, 3, (k) => {
        k.u32(0).u32(0).u32(t.id).u32(0).u32(0)
          .u32(0).u32(0).u16(0).u16(0)
          .u16(t.kind === 'audio' ? 0x0100 : 0).u16(0);
        for (const v of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) k.u32(v);
        // Width and height are 16.16 fixed point, and are the *display* size.
        k.fixed(t.width).fixed(t.height);
      });
      tr.box('mdia', (md) => {
        md.full('mdhd', 0, 0, (h) => {
          h.u32(0).u32(0).u32(t.timescale).u32(0)
            // 'und' packed five bits a letter, which is how this field has
            // always worked and is not worth a table.
            .u16(0x55c4).u16(0);
        });
        md.full('hdlr', 0, 0, (h) => {
          h.u32(0).str(t.kind === 'video' ? 'vide' : 'soun');
          h.u32(0).u32(0).u32(0);
          h.str(t.kind === 'video' ? 'VideoHandler' : 'SoundHandler').u8(0);
        });
        md.box('minf', (mi) => {
          if (t.kind === 'video') mi.full('vmhd', 0, 1, (v) => { v.u16(0).u16(0).u16(0).u16(0); });
          else mi.full('smhd', 0, 0, (v) => { v.u16(0).u16(0); });
          mi.box('dinf', (di) => {
            di.full('dref', 0, 0, (d) => {
              d.u32(1);
              // Flag 1: the data is in this file. There is no other file.
              d.full('url ', 0, 1, () => {});
            });
          });
          mi.box('stbl', (st) => {
            st.full('stsd', 0, 0, (sd) => {
              sd.u32(1);
              if (t.kind === 'video') this.avc1(sd, t); else this.mp4a(sd, t);
            });
            // Empty, and that is the point of a fragmented file: the tables
            // that would live here are in each fragment instead.
            st.full('stts', 0, 0, (x) => x.u32(0));
            st.full('stsc', 0, 0, (x) => x.u32(0));
            st.full('stsz', 0, 0, (x) => x.u32(0).u32(0));
            st.full('stco', 0, 0, (x) => x.u32(0));
          });
        });
      });
    });
  }

  avc1(sd, t) {
    sd.box('avc1', (v) => {
      v.u32(0).u16(0).u16(1);
      v.u16(0).u16(0).u32(0).u32(0).u32(0);
      v.u16(t.width).u16(t.height);
      v.u32(0x00480000).u32(0x00480000).u32(0).u16(1);
      for (let i = 0; i < 32; i++) v.u8(0);
      v.u16(0x0018).u16(0xffff);
      // The decoder's own configuration, exactly as the encoder handed it over.
      // Writing this by hand from the SPS would be reimplementing the encoder's
      // opinion of its own output.
      if (t.description) v.box('avcC', (c) => c.bytes(t.description));
    });
  }

  mp4a(sd, t) {
    sd.box('mp4a', (a) => {
      a.u32(0).u16(0).u16(1);
      a.u32(0).u32(0);
      a.u16(t.channels).u16(16).u16(0).u16(0);
      a.fixed(t.rate);
      a.full('esds', 0, 0, (e) => {
        const cfg = t.description || new Uint8Array(0);
        // The three nested descriptors AAC-in-MP4 is described by. The lengths
        // are the short form, which holds anything a config will ever be.
        e.u8(0x03).u8(23 + cfg.length).u16(1).u8(0);
        e.u8(0x04).u8(15 + cfg.length).u8(0x40).u8(0x15)
          .u24(0).u32(0).u32(0);
        e.u8(0x05).u8(cfg.length).bytes(cfg);
        e.u8(0x06).u8(1).u8(2);
      });
    });
  }

  /// One `moof` plus the `mdat` it describes.
  fragment() {
    const taking = this.tracks.map((t) => ({ track: t, samples: t.samples.splice(0) }))
      .filter((x) => x.samples.length);
    if (!taking.length) return new Uint8Array(0);
    // Where the picture has got to *before* this fragment moves it on, which is
    // this fragment's own start. Read here because the write loop advances it.
    const startedAt = this.video ? this.video.at : 0;

    // The offsets in `trun` are measured from the start of the `moof`, which is
    // why the whole thing is written once to find its length and then written
    // again with the offsets filled in. Cheaper than it sounds — a `moof` is a
    // few hundred bytes — and far cheaper than getting it wrong.
    const build = (offsets) => {
      const w = new Mp4Writer();
      w.box('moof', (mo) => {
        mo.full('mfhd', 0, 0, (m) => m.u32(this.sequence));
        taking.forEach(({ track, samples }, i) => {
          mo.box('traf', (tf) => {
            // 0x020000: this track's data is measured from the moof, not from
            // some absolute place in a file that is still being written.
            tf.full('tfhd', 0, 0x020000, (h) => h.u32(track.id));
            tf.full('tfdt', 1, 0, (h) => h.u64(track.at));
            // Version 1 so a composition offset may be negative, which B-frames
            // require and which version 0 cannot say.
            tf.full('trun', 1, 0x000f01, (r) => {
              r.u32(samples.length);
              r.u32(offsets ? offsets[i] : 0);
              for (const s of samples) {
                r.u32(s.duration);
                r.u32(s.data.length);
                // A sample that is not a sync point depends on others and
                // cannot be seeked to; saying so is what makes seeking work.
                r.u32(s.sync ? 0x02000000 : 0x01010000);
                r.u32(0);
              }
            });
          });
        });
      });
      return w.done();
    };

    const probe = build(null);
    // `mdat` header is eight bytes, then each track's run in order.
    let at = probe.length + 8;
    const offsets = [];
    for (const { samples } of taking) {
      offsets.push(at);
      at += samples.reduce((s, x) => s + x.data.length, 0);
    }
    const moof = build(offsets);

    const total = at;
    const out = new Uint8Array(total);
    out.set(moof, 0);
    const mdatLen = total - moof.length;
    const dv = new DataView(out.buffer);
    dv.setUint32(moof.length, mdatLen);
    out[moof.length + 4] = 0x6d; // m
    out[moof.length + 5] = 0x64; // d
    out[moof.length + 6] = 0x61; // a
    out[moof.length + 7] = 0x74; // t
    let p = moof.length + 8;
    for (const { track, samples } of taking) {
      for (const s of samples) {
        out.set(s.data, p);
        p += s.data.length;
        track.at += s.duration;
      }
    }
    // What this fragment came to, for the index.
    const vid = taking.find((x) => x.track === this.video);
    if (vid) {
      this.fragments.push({
        bytes: total,
        time: startedAt,
        duration: vid.samples.reduce((n, x) => n + x.duration, 0),
        sync: !!vid.samples[0].sync,
      });
    }
    this.sequence++;
    return out;
  }

  /// `sidx`: which byte each stretch of time begins at.
  ///
  /// **Without this a fragmented file cannot be scrubbed.** The samples already
  /// say which of them are sync points, but that only helps a player that has
  /// already found the right fragment, and in a fragmented file nothing says
  /// where the fragments are. A player asked for ten seconds in has no way to
  /// work out which `moof` holds it short of reading every one from the front.
  /// Some do. Most hand back the first frame instead.
  ///
  /// One index for the whole file, written between the `moov` and the first
  /// fragment — so `first_offset` is nought: the first fragment begins where
  /// this box ends.
  index() {
    const t = this.video;
    const w = new Mp4Writer();
    w.full('sidx', 0, 0, (b) => {
      b.u32(t.id);
      b.u32(t.timescale);
      b.u32(this.fragments.length ? this.fragments[0].time : 0);
      b.u32(0);
      b.u16(0);
      b.u16(this.fragments.length);
      for (const f of this.fragments) {
        // Top bit clear: this reference is media, not another index.
        b.u32(f.bytes & 0x7fffffff);
        b.u32(f.duration);
        // Starts with a stream access point of type 1 — an IDR needing nothing
        // before it. Say otherwise and a player decodes from the fragment
        // before to be safe, which is the stall this box exists to avoid.
        b.u32(f.sync ? 0x90000000 : 0);
      }
    });
    return w.done();
  }

  /// Everything still held, then the file.
  finish(type = 'video/mp4') {
    this.cutFragments();
    if (!this.started) {
      this.parts.unshift(this.header());
      this.started = true;
    }
    // Between the header and the first fragment, which is where a `first_offset`
    // of nought says it is.
    if (this.video && this.fragments.length) this.parts.splice(1, 0, this.index());
    return new Blob(this.parts, { type });
  }
}
