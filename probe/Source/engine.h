// The engine's C interface (engine-capi/src/lib.rs has the notes).
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NeEngine NeEngine;

enum { NE_SINE = 1, NE_GAIN, NE_DELAY, NE_LFO, NE_CLOCK, NE_PULSE, NE_VOICE, NE_KEYS, NE_SOUND_SOURCE, NE_PLAYER };

NeEngine* ne_new (float rate, uint32_t max_block, uint32_t log_applied, uint32_t fade_frames);
void ne_free (NeEngine*);
void ne_render (NeEngine*, float* l, float* r, uint32_t n);
uint64_t ne_frame (NeEngine*);
int32_t ne_add (NeEngine*, uint32_t id, uint32_t kind, float a, float b);
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

#ifdef __cplusplus
}
#endif
