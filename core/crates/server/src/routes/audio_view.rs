//! Peaks, thumbnails, the spectrogram and the audio stream.

use super::*;

pub(super) fn api_peaks(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };

    let info = *reader.info();
    // When the file has edits and the caller asks for them, the waveform shows
    // the edited timeline — otherwise the display would not match playback.
    let edited = req.param("edited") == Some("1");
    // `clips=1` is the edited clips without the stretch: the timeline the
    // selection, the cursor and the playhead are counted on, so an insert or a
    // cut shows in the picture where it is heard. A document whose clips are
    // still the whole file takes the cached path, as though it were unedited.
    let clips_only = !edited && req.param("clips") == Some("1");
    let list = if edited || clips_only { app.edits.snapshot(req.param("p").unwrap_or("")) } else { None };
    let list = match list {
        Some(mut l) if clips_only => {
            let whole = l.clips.len() == 1 && l.clips[0] == edit::Clip::new(0, l.source_frames);
            if whole { None } else { l.stretch = fx::Stretch::default(); Some(l) }
        }
        other => other,
    };
    let frames = list.as_ref().map_or(info.frames(), |l| l.frames());

    // Zoom range, in frames. Defaults to the whole file.
    let from: u64 = req.number("from", 0);
    let to: u64 = req.number("to", frames);
    let to = to.min(frames);
    let count = to.saturating_sub(from);
    // Cap the column count: a request for a million columns is a mistake, and
    // honouring it would allocate hundreds of megabytes.
    let columns: usize = req.number::<usize>("cols", 1000).clamp(1, 8192);

    let rel = req.param("p").unwrap_or("");
    // **Dry.** The waveform shows the material, not the effects.
    //
    // It used to be rendered through the rack, so that what you saw was what
    // you would hear. The intention was right and the cost was not: every
    // release of every rack control re-rendered the whole visible span, which
    // zoomed out is the entire file — and that one offline pass is most of what
    // made a real-time engine feel like it was rendering.
    //
    // It was also not quite true. That render built a *fresh* rack from the
    // spec and warmed it with pre-roll; the chain you are hearing has been
    // running continuously with real history. For an EQ the two agree, but a
    // compressor with a long release does not, so the picture was an
    // approximation being paid for as though it were a recording.
    //
    // The edit list still shapes it — cuts, fades and stretch change the
    // material and belong here. The rack does not: it is processing, and
    // processing is what the meters and the speakers are for.
    let tile = match &list {
        Some(l) => edit::render::peak_tile(l, &mut reader, from, count, columns),
        None => reader.peak_tile(from, count, columns),
    };
    let tile = match tile {
        Ok(t) => t,
        Err(e) => return Response::error(500, &e.to_string()),
    };

    // Flat arrays per channel rather than objects per column: the payload is
    // three numbers per pixel per channel and object overhead would dominate.
    let channels: Vec<Value> = (0..tile.channels)
        .map(|ch| {
            let cols = tile.channel(ch);
            Value::obj()
                .set("min", cols.iter().map(|c| c.min).collect::<Vec<f32>>())
                .set("max", cols.iter().map(|c| c.max).collect::<Vec<f32>>())
                .set("rms", cols.iter().map(|c| c.rms).collect::<Vec<f32>>())
        })
        .collect();

    Response::json(
        Value::obj()
            .set("frames", frames)
            .set("from", from)
            .set("to", to)
            .set("columns", tile.columns)
            .set("sampleRate", info.sample_rate)
            .set("channels", Value::Arr(channels))
            .to_string(),
    )
}

/// Waveform overviews for a batch of files, for the browser list.
///
/// Batched rather than one request per row: a folder of several hundred files
/// would otherwise queue behind the browser's per-host connection limit.
/// Each thumbnail is one byte per column, so a 28-column overview is 28 bytes.
pub(super) fn api_thumbs(app: &Arc<App>, req: &Request) -> Response {
    let Some(v) = json::parse(&String::from_utf8_lossy(&req.body)) else {
        return Response::error(400, "invalid JSON");
    };
    let Some(Value::Arr(paths)) = v.get("paths") else {
        return Response::error(400, "expected a \"paths\" array");
    };
    let cols = match v.get("cols") {
        Some(Value::Num(n)) => (*n as usize).clamp(4, 128),
        _ => 28,
    };
    let Some(lib) = app.library_path() else {
        return Response::error(400, "no library chosen");
    };

    let mut out = std::collections::BTreeMap::new();
    // Cap the batch so one oversized request cannot stall the server for
    // everyone else; the UI asks for more as the user scrolls.
    for item in paths.iter().take(400) {
        let Some(rel) = item.as_str() else { continue };
        let Some(path) = resolve_within(&lib, rel) else { continue };
        let Ok(mut reader) = audio_core::open(&path) else { continue };
        let frames = reader.info().frames();
        let Ok(tile) = reader.peak_tile(0, frames, cols) else { continue };

        // One byte per column: the larger of |min| and |max|, summed across
        // channels. A thumbnail this size cannot show more than an outline.
        let mut bytes = vec![0u8; tile.columns];
        for ch in 0..tile.channels {
            for (i, c) in tile.channel(ch).iter().enumerate() {
                let amp = c.max.abs().max(c.min.abs()).min(1.0);
                let v = (amp * 255.0) as u8;
                if v > bytes[i] {
                    bytes[i] = v;
                }
            }
        }
        out.insert(rel.to_string(), Value::Str(base64(&bytes)));
    }

    Response::json(Value::Obj(out).to_string())
}

pub(super) fn api_spectrogram(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let mut reader = match audio_core::open(&path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let frames = reader.info().frames();
    let from: u64 = req.number("from", 0);
    let to: u64 = req.number::<u64>("to", frames).min(frames);
    let columns: usize = req.number::<usize>("cols", 600).clamp(1, 2048);
    let fft_size: usize = req.number::<usize>("fft", 1024).clamp(64, 8192);

    let s = match reader.spectrogram(from, to.saturating_sub(from), columns, fft_size) {
        Ok(s) => s,
        Err(e) => return Response::error(500, &e.to_string()),
    };

    // One byte per cell, base64'd. A 600x513 tile is ~300 KB raw; as a JSON
    // array of numbers it would be nearer 1.5 MB.
    Response::json(
        Value::obj()
            .set("columns", s.columns)
            .set("bins", s.bins)
            .set("maxHz", s.max_hz)
            .set("floorDb", s.floor_db)
            .set("from", from)
            .set("to", to)
            .set("data", base64(&s.data))
            .to_string(),
    )
}

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Stream any supported format to the browser as WAV.
///
/// AIFF and headerless PCM are re-wrapped, not re-encoded, so the response
/// length is known exactly up front and range requests resolve with plain
/// arithmetic — which is what makes seeking work.
pub(super) fn api_audio(app: &Arc<App>, req: &Request) -> Response {
    let path = match library_file(app, req) {
        Ok(p) => p,
        Err(r) => return r,
    };
    // Playing the edited version renders on the fly. The length comes from the
    // clip list, so seeking works without rendering the whole thing first.
    let rel = req.param("p").unwrap_or("");
    // `dry=1` is the material on the timeline the selection and the cue are
    // counted on: the edited clips, no stretch and never the rack. It is what
    // `/api/peaks?clips=1` draws, for a picture that needs the samples.
    let dry = req.param("dry") == Some("1");
    if dry {
        if let Some(mut list) = app.edits.snapshot(rel) {
            if !(list.clips.len() == 1 && list.clips[0] == edit::Clip::new(0, list.source_frames)) {
                list.stretch = fx::Stretch::default();
                return audio_edited(&path, &list, &mut fx::Rack::new(), req);
            }
        }
    }
    let rack_active = !dry && app.racks.is_active(rel);
    if (req.param("edited") == Some("1") && !dry) || rack_active {
        let list = app.edits.snapshot(rel).or_else(|| {
            // A rack with no edits still needs the rendering path.
            audio_core::open(&path).ok().map(|r| {
                let i = r.info();
                edit::EditList::identity(i.frames(), i.channels, i.sample_rate)
            })
        });
        if let Some(list) = list {
            let mut rack = app.racks.get(rel).build(list.sample_rate, list.channels as usize);
            return audio_edited(&path, &list, &mut rack, req);
        }
    }

    let mut src = match FileSource::open(&path) {
        Ok(s) => s,
        Err(e) => return Response::error(404, &e.to_string()),
    };
    let info = match probe(&mut src) {
        Ok(i) => i,
        Err(e) => return Response::error(400, &e.to_string()),
    };

    let total = wav::stream_len(&info);
    let range = req.header("range").and_then(|h| parse_range(h, total));
    let (start, end) = match range {
        Some(r) => (r.start, r.end),
        None => (0, total.saturating_sub(1)),
    };
    if total == 0 {
        return Response::error(416, "file has no audio data");
    }

    let header = wav::header(info.data_len, info.channels, info.sample_rate, info.codec);
    let mut out: Vec<u8> = Vec::with_capacity((end - start + 1) as usize);

    // The requested window may cover part of the header, part of the samples,
    // or straddle the boundary.
    if start < wav::HEADER_LEN {
        let h_end = (end + 1).min(wav::HEADER_LEN);
        out.extend_from_slice(&header[start as usize..h_end as usize]);
    }
    if end >= wav::HEADER_LEN {
        let data_start = start.saturating_sub(wav::HEADER_LEN);
        let data_end = end - wav::HEADER_LEN;
        let len = (data_end - data_start + 1) as usize;
        let mut buf = vec![0u8; len];
        let got = src
            .read_at(info.data_offset + data_start, &mut buf)
            .unwrap_or(0);
        buf.truncate(got);
        wav::convert_samples(&mut buf, info.codec, info.endian, data_start);
        out.extend_from_slice(&buf);
    }

    let status = if range.is_some() { 206 } else { 200 };
    let mut r = Response::new(status, "audio/wav", out);
    r = r.with("Accept-Ranges", "bytes").with("Cache-Control", "no-store");
    if range.is_some() {
        r = r.with("Content-Range", &format!("bytes {start}-{end}/{total}"));
    }
    r
}

/// Stream the edited timeline as 16-bit WAV, honouring range requests.
fn audio_edited(
    path: &Path,
    list: &edit::EditList,
    rack: &mut fx::Rack,
    req: &Request,
) -> Response {
    const BITS: u16 = 16;
    let mut reader = match audio_core::open(path) {
        Ok(r) => r,
        Err(e) => return Response::error(400, &e.to_string()),
    };
    let total = edit::render::wav_stream_len(list, BITS);
    if total <= wav::HEADER_LEN {
        return Response::error(400, "the edit is empty");
    }

    let range = req.header("range").and_then(|h| parse_range(h, total));
    let (start, end) = match range {
        Some(r) => (r.start, r.end),
        None => (0, total - 1),
    };

    match edit::render::wav_bytes_fx(list, &mut reader, rack, start, end, BITS) {
        Ok(bytes) => {
            let status = if range.is_some() { 206 } else { 200 };
            let mut r = Response::new(status, "audio/wav", bytes)
                .with("Accept-Ranges", "bytes")
                .with("Cache-Control", "no-store");
            if range.is_some() {
                r = r.with("Content-Range", &format!("bytes {start}-{end}/{total}"));
            }
            r
        }
        Err(e) => Response::error(500, &e.to_string()),
    }
}
