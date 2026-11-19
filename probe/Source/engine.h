// The engine's C interface (engine-capi/src/lib.rs has the notes).
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NeEngine NeEngine;

enum { NE_SINE = 1, NE_GAIN, NE_DELAY, NE_LFO, NE_CLOCK, NE_PULSE, NE_VOICE, NE_KEYS, NE_SOUND_SOURCE, NE_PLAYER,
       // MultiGrainLive's own: the Wave synth; its master ceiling; a grain deck playing a test sound
       // (a: 0 Granular, 1 WSOLA, 2 Vocoder, 3 PVSOLA; b: Poly voices); a mixer (a: inputs).
       NE_WAVE, NE_CEILING, NE_GRAIN, NE_MIX,
       // a: zero-based host channel-pair index; missing right channel is silence.
       NE_INPUT };

NeEngine* ne_new (float rate, uint32_t max_block, uint32_t log_applied, uint32_t fade_frames);
void ne_free (NeEngine*);
// Controller thread. 0 queued; -13 bad rate, -14 unsupported module, -15 busy.
int32_t ne_set_rate(NeEngine*, float rate);
int32_t ne_render (NeEngine*, float* l, float* r, uint32_t n);
// Planar input: channels may be zero; individual null channels mean silence.
// Each non-null channel contains n floats and must not alias l/r. All input
// storage stays immutable until return. Status codes match ne_render.
// As with ne_render, final device output retains the finite/[-1,1] guard
// and callback denormal mode; Input itself performs an exact copy.
// Input/output round-trip latency is the host device figure plus the patch
// plan's declared latency; this input adapter adds zero frames.
int32_t ne_render_io(NeEngine*, const float* const* inputs, uint32_t channels, float* l, float* r, uint32_t n);
uint64_t ne_frame (NeEngine*);
uint64_t ne_bad_blocks (NeEngine*);
int32_t ne_add (NeEngine*, uint32_t id, uint32_t kind, float a, float b);
// Recorder has one stereo audio input, no outputs. Param 0 starts (>=0.5)
// or stops (<0.5), stamped with ne_param. Callback runs on a helper and must
// return eventually, never throw, and keep user data valid until ne_free
// returns. Capacity in frames,
// rounded up to a power of two. A full ring drops frames without waiting.
typedef void (*NeRecordSink)(void* user, uint64_t frame, float rate, float l, float r);
int32_t ne_add_recorder(NeEngine*, uint32_t id, uint32_t capacity, NeRecordSink, void* user);
typedef struct NeRecordingReport {
    uint32_t module, kind; // 1 overflow, 2 rate-change stop
    uint64_t frame;
    float old_rate, new_rate;
    uint64_t dropped; // cumulative at read, one overflow notice per instance
} NeRecordingReport;
// ne_set_rate stops active recording on its exact boundary, including the
// outgoing fade. A new explicit Start is required; no implicit rate splicing.
uint32_t ne_recording_reports(NeEngine*, NeRecordingReport*, uint32_t max);
// Live cumulative count for the last overflow-noticed instance of this
// module stays readable after the notice. Rate rebuilds create new instances.
uint64_t ne_recording_dropped(NeEngine*, uint32_t module);
// One of prism-fx's effects by its catalogue id, e.g. "dattorro-plate".
int32_t ne_add_fx (NeEngine*, uint32_t id, const char* name);
int32_t ne_remove (NeEngine*, uint32_t id);
int32_t ne_connect (NeEngine*, uint32_t from_module, uint32_t from_port, uint32_t to_module, uint32_t to_port);
int32_t ne_disconnect (NeEngine*, uint32_t from_module, uint32_t from_port, uint32_t to_module, uint32_t to_port);
int32_t ne_connect_out (NeEngine*, uint32_t module, uint32_t out_port);
int64_t ne_commit (NeEngine*, uint64_t frame);
int64_t ne_param (NeEngine*, uint64_t frame, uint32_t module, uint32_t index, float value);
int64_t ne_note (NeEngine*, uint64_t frame, uint32_t module, uint32_t on, uint32_t note, float velocity);
int64_t ne_load_sound (NeEngine*, uint64_t frame, uint32_t id, const float* l, const float* r, uint32_t frames, float rate);
int64_t ne_point_sound (NeEngine*, uint64_t frame, uint32_t module, uint32_t slot, uint32_t id, uint32_t version);
uint32_t ne_collect (NeEngine*);
uint32_t ne_applied (NeEngine*, uint64_t* seqs, uint64_t* frames, uint32_t max);

// Read module panic ids; UINT32_MAX means the engine must be recreated.
uint32_t ne_panicked (NeEngine*, uint32_t* ids, uint32_t max);

#ifdef __cplusplus
}
#endif
