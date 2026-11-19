//! Independent validation of the files written for the Stems page.
use songprint::midi::{self, Note, Part, Song, Timing, PPQ};

struct Bytes<'a> { bytes: &'a [u8], pos: usize }
impl<'a> Bytes<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).filter(|&v| v <= self.bytes.len()).ok_or("truncated chunk or event")?;
        let b = &self.bytes[self.pos..end]; self.pos = end; Ok(b)
    }
    fn byte(&mut self) -> Result<u8, String> { Ok(self.take(1)?[0]) }
    fn var(&mut self) -> Result<u32, String> {
        let mut value = 0;
        for _ in 0..4 { let b = self.byte()?; value = (value << 7) | (b & 127) as u32; if b < 128 { return Ok(value); } }
        Err("variable-length number exceeds four bytes".into())
    }
}
fn track(bytes: &[u8], first: bool) -> Result<(), String> {
    let mut c = Bytes { bytes, pos: 0 };
    let mut running = None;
    let mut channel = None;
    let mut held = [[false; 128]; 16];
    let mut ends = 0;
    while c.pos < bytes.len() {
        c.var()?;
        let b = c.byte()?;
        if b == 0xff {
            running = None;
            let kind = c.byte()?;
            if kind > 127 { return Err("meta type out of range".into()); }
            let n = c.var()? as usize;
            let data = c.take(n)?;
            match kind {
                0x2f => { ends += 1; if n != 0 || c.pos != bytes.len() { return Err("end-of-track is not the last event or has data".into()); } }
                0x51 if n != 3 || data.iter().all(|&x| x == 0) => return Err("invalid tempo".into()),
                0x03 | 0x06 if std::str::from_utf8(data).is_err() => return Err("name or marker is not UTF-8".into()),
                _ => {}
            }
            continue;
        }
        if b == 0xf0 || b == 0xf7 { running = None; let n = c.var()? as usize; c.take(n)?; continue; }
        let (status, d1) = if b >= 128 {
            if b >= 0xf0 { return Err("status out of range".into()); }
            running = Some(b); (b, c.byte()?)
        } else { (running.ok_or("running status without a channel status")?, b) };
        if first { return Err("channel event in conductor track".into()); }
        let ch = status & 15;
        if channel.is_some_and(|was| was != ch) { return Err("multiple channels in a part track".into()); }
        channel = Some(ch);
        let kind = status & 0xf0;
        let d2 = if kind == 0xc0 || kind == 0xd0 { 0 } else { c.byte()? };
        if d1 > 127 || d2 > 127 { return Err("data byte out of range".into()); }
        let sounding = &mut held[ch as usize][d1 as usize];
        match kind {
            0x90 => {
                if d2 == 0 { return Err("zero-velocity note-on".into()); }
                if *sounding { return Err(format!("overlapping note-on: channel {}, pitch {d1}", ch + 1)); }
                *sounding = true;
            }
            0x80 => { if !*sounding { return Err("note-off without a sounding note".into()); } *sounding = false; }
            _ => {}
        }
    }
    if ends != 1 { return Err("track must contain exactly one end-of-track".into()); }
    if held.iter().flatten().any(|x| *x) { return Err("note still sounding at end-of-track".into()); }
    Ok(())
}
fn check(bytes: &[u8]) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    if bytes.len() < 14 || &bytes[..10] != b"MThd\0\0\0\x06\0\x01" || bytes[12..14] != [1, 224] {
        return Err(vec!["header must be MThd, length 6, format 1, PPQ 480".into()]);
    }
    let expected = u16::from_be_bytes([bytes[10],bytes[11]]) as usize;
    let mut c = Bytes { bytes, pos: 14 };
    let mut count = 0;
    while c.pos < bytes.len() {
        let chunk = match c.take(8) { Ok(h) => h, Err(e) => { errors.push(e); break; } };
        if &chunk[..4] != b"MTrk" { errors.push("expected MTrk chunk".into()); }
        let n = u32::from_be_bytes(chunk[4..8].try_into().unwrap()) as usize;
        let data = match c.take(n) { Ok(data) => data, Err(e) => { errors.push(e); break; } };
        if let Err(e) = track(data, count == 0) { errors.push(format!("track {count}: {e}")); }
        count += 1;
    }
    if count != expected || count == 0 { errors.push("track count does not match header".into()); }
    if errors.is_empty() { Ok(()) } else { Err(errors) }
}
fn n(bar: u32, step: f32, steps: f32, note: u8, vel: f32) -> Note { Note { bar, step, steps, note, vel } }
fn fixture(played: bool, each_bar: bool, bass_up: bool, downbeat: usize) -> Song {
    Song {
        title: "Été — 東京".into(),
        timing: if played { Timing::Played { beats_s: vec![0.2,0.7,1.2,1.7], downbeat_beat: downbeat } } else { Timing::Grid { bpm: 113.5 } },
        markers: vec![(0,"Entrée".into()),(2,"終わり".into())],
        parts: vec![
            Part { name: "Drums".into(), channel:10, notes:midi::drums(&[[vec![1.0,0.0,0.0,0.0,0.5],vec![0.0,0.0,1.0],vec![1.0,0.5]]]) },
            Part { name: "Bass".into(), channel:5, notes:vec![n(0,1.25,3.5,30+if bass_up {12} else {0},0.6)] },
            Part { name: "Chords".into(), channel:6, notes:midi::chords(&[(0,"Fmaj7".into()),(2,"Dm".into())],3,each_bar) },
            Part { name: "Melody".into(), channel:7, notes:vec![n(1,2.5,4.0,69,1.0)] },
            Part { name: "Other".into(), channel:8, notes:vec![n(2,15.0,1.0,62,0.5)] },
            Part { name: "Empty".into(), channel:9, notes:vec![] },
        ],
    }
}
#[test]
fn every_stems_choice_is_a_strict_file() {
    for played in [false,true] { for each in [false,true] { for up in [false,true] { for downbeat in [0,3] {
        check(&midi::write(&fixture(played,each,up,downbeat))).unwrap();
    } } } }
}
#[test]
fn a_nonoverlapping_fixture_keeps_its_original_bytes() {
    let bytes = midi::write(&fixture(false,false,false,0));
    let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h,b| (h ^ *b as u64).wrapping_mul(0x100000001b3));
    println!("MAIN_FIXTURE {} {hash:016x}",bytes.len());
    assert_eq!(bytes.len(), 341);
    assert_eq!(hash, 0xe59e22a6ac4f6a17);
}
#[test]
fn zero_length_last_step_overlap_and_same_tick_restrike_are_valid() {
    let mut song = fixture(false,false,false,0);
    song.parts[1].notes = vec![n(0,0.0,0.0,40,0.0),n(0,1.0,8.0,40,0.5),n(0,3.0,1.0,40,1.0),n(0,4.0,2.0,40,0.7),n(0,7.0,1.0,40,0.5),n(0,7.0,2.0,40,0.8),n(2,15.0,0.0,40,1.0)];
    check(&midi::write(&song)).unwrap();
}
fn file(tracks: &[&[u8]]) -> Vec<u8> {
    let mut out = b"MThd\0\0\0\x06\0\x01".to_vec(); out.extend((tracks.len() as u16).to_be_bytes()); out.extend([1,224]);
    for t in tracks { out.extend(b"MTrk"); out.extend((t.len() as u32).to_be_bytes()); out.extend(*t); } out
}
#[test]
fn malformed_files_are_rejected_by_the_independent_checker() {
    let end: &[u8] = &[0,255,47,0];
    let bad: Vec<&[u8]> = vec![
        &[], &[0,255,47,1,0], &[0,255,47,0,0,255,47,0], &[128,128,128,128,0,255,47,0],
        &[0,60,100,0,255,47,0], &[0,241,0,0,255,47,0], &[0,144,128,100,0,255,47,0],
        &[0,144,60,0,0,255,47,0], &[0,144,60,100,0,144,60,100,0,255,47,0],
        &[0,128,60,0,0,255,47,0], &[0,144,60,100,0,255,47,0],
        &[0,144,60,100,1,128,60,0,0,145,62,100,0,255,47,0],
        &[0,255,81,2,1,2,0,255,47,0], &[0,255,81,3,0,0,0,0,255,47,0],
        &[0,255,3,1,255,0,255,47,0], &[0,255,6,1,255,0,255,47,0],
    ];
    for t in bad { assert!(check(&file(&[end,t])).is_err(),"accepted {t:?}"); }
    assert!(check(&file(&[&[0,144,60,100,1,128,60,0,0,255,47,0]])).is_err());
    let good = file(&[end,end]); check(&good).unwrap();
    for (offset,value) in [(0,b'X'),(7,7),(9,0),(11,3),(13,225),(18,127)] { let mut b=good.clone(); b[offset]=value; assert!(check(&b).is_err(),"offset {offset}"); }
    for cut in 0..good.len() { assert!(check(&good[..cut]).is_err(),"truncation at {cut}"); }
    // Valid running status is accepted, and metadata clears it.
    check(&file(&[end,&[0,144,60,100,1,62,100,1,128,60,0,0,62,0,0,255,47,0]])).unwrap();
    assert!(check(&file(&[end,&[0,144,60,100,0,255,3,0,1,60,0,0,255,47,0]])).is_err());
}

const SEED: u32 = 0x005a_17e1;
fn random(s: &mut u32) -> u32 { *s = s.wrapping_mul(1664525).wrapping_add(1013904223); *s }
#[test]
fn two_hundred_seeded_songs_are_strict_and_read_back_to_the_tick() {
    let mut seed=SEED;
    let mut faults=Vec::new();
    for case in 0..200 {
        let played=case%2==1;
        let mut song=fixture(played,case%3==0,case%5==0,case%4);
        song.parts.truncate(1+random(&mut seed) as usize%5);
        for part in &mut song.parts {
            part.notes.clear();
            for i in 0..1+random(&mut seed)%30 {
                let tick=random(&mut seed)%5760;
                let length=random(&mut seed)%1921;
                let vel=if i==0 {if case%3==0 {0.0} else {1.0}} else {(random(&mut seed)>>8) as f32/16777215.0};
                part.notes.push(n(tick/1920,(tick%1920) as f32/120.0,length as f32/120.0,48+(random(&mut seed)%12) as u8,vel));
            }
        }
        let bytes=midi::write(&song);
        if let Err(e)=check(&bytes) { faults.push(format!("case {case} seed {SEED:#x}: {e:?}")); continue; }
        let read=midi::read(&bytes).unwrap();
        assert_eq!(read.parts.len(),song.parts.len());
        let lead=if played {(case as u32%4+1)*PPQ} else {0};
        for (part,got) in song.parts.iter().zip(&read.parts) {
            assert_eq!((part.name.as_str(),part.channel),(got.name.as_str(),got.channel));
            // Quantize independently into absolute ticks, then apply the rule
            // that only one note of a pitch can sound at once on a channel.
            let mut wanted:Vec<_>=part.notes.iter().enumerate().map(|(i,n)| {
                let on=lead+((n.bar as f64*16.0+n.step as f64)*120.0).round() as u32;
                let off=(lead+((n.bar as f64*16.0+(n.step+n.steps) as f64)*120.0).round() as u32).max(on+1);
                (n.note,on,off,(30.0+n.vel*97.0).round() as u8,i)
            }).collect();
            wanted.sort_by_key(|x|(x.0,x.1,x.4));
            let mut expected=Vec::new();
            for (i,&(pitch,on,mut off,velocity,_)) in wanted.iter().enumerate() {
                if let Some(next)=wanted.get(i+1).filter(|next|next.0==pitch) {
                    if next.1==on {continue;}
                    off=off.min(next.1);
                }
                expected.push((on,pitch,off-on,velocity));
            }
            expected.sort_by_key(|x|(x.0,x.1));
            assert_eq!(expected.len(),got.notes.len(),"case {case}");
            for ((on,pitch,length,velocity),note) in expected.iter().zip(&got.notes) {
                assert_eq!((note.bar*1920+(note.step*120.0).round() as u32,note.note,(note.steps*120.0).round() as u32),(*on,*pitch,*length),"case {case}");
                // The reader floors a velocity at 0.05 on purpose, so a soft note never reads back silent.
                let vel=((*velocity as f32-30.0)/97.0).max(0.05);
                if (vel-note.vel).abs()>1e-6 { faults.push(format!("case {case}, channel {}, pitch {pitch}, tick {on}: written velocity {velocity} means {vel}, reader returned {}",part.channel,note.vel)); }
            }
        }
    }
    assert!(faults.is_empty(),"seed {SEED:#x}, {} faults:\n{}",faults.len(),faults.join("\n"));
}
