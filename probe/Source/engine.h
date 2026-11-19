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
       NE_WAVE, NE_CEILING, NE_GRAIN, NE_MIX };

NeEngine* ne_new (float rate, uint32_t max_block, uint32_t log_applied, uint32_t fade_frames);
void ne_free (NeEngine*);
// Controller thread. 0 queued; -13 bad rate, -14 unsupported module, -15 busy.
int32_t ne_set_rate(NeEngine*, float rate);
int32_t ne_render (NeEngine*, float* l, float* r, uint32_t n);
uint64_t ne_frame (NeEngine*);
uint64_t ne_bad_blocks (NeEngine*);
int32_t ne_add (NeEngine*, uint32_t id, uint32_t kind, float a, float b);
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
