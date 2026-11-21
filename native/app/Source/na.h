// The app's C interface (engine-capi/src/app.rs has the notes).
//
// na_render belongs to the audio thread; every other call to the app, never
// two at once (the app holds its own lock around them). Text comes back as
// snprintf gives it: the whole length is returned; call again with more room
// if it is cap or more. Codes below zero: -2 no such module, -3 no such
// socket, -4 kinds differ, -6 that input has a cable, -10 no such kind,
// -12 a panic was caught, -16 no such control, -17 a file that could not be
// read (na_error says why).
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct NaApp NaApp;

NaApp* na_new (float rate, uint32_t max_block);
void na_free (NaApp*);
int32_t na_render (NaApp*, float* l, float* r, uint32_t n);

uint32_t na_kinds (char* buf, uint32_t cap);
uint32_t na_controls (const char* kind, char* buf, uint32_t cap);
uint32_t na_error (NaApp*, char* buf, uint32_t cap);

int32_t na_add (NaApp*, const char* kind, float x, float y);
int32_t na_remove (NaApp*, uint32_t id);
int32_t na_place (NaApp*, uint32_t id, float x, float y);
int32_t na_connect (NaApp*, uint32_t from, uint32_t from_socket, uint32_t to, uint32_t to_socket);
int32_t na_disconnect (NaApp*, uint32_t from, uint32_t from_socket, uint32_t to, uint32_t to_socket);
int32_t na_set (NaApp*, uint32_t id, uint32_t index, float value);
int32_t na_note (NaApp*, uint32_t id, uint32_t on, uint32_t note, float velocity);
int32_t na_midi (NaApp*, uint32_t id, const uint8_t* bytes, uint32_t n);
void na_collect (NaApp*);
void na_settle (NaApp*);

uint32_t na_save (NaApp*, char* buf, uint32_t cap);
uint32_t na_describe (NaApp*, char* buf, uint32_t cap);
int32_t na_load (NaApp*, const char* json);
int32_t na_set_view (NaApp*, const char* json);

uint32_t na_wave_patch (NaApp*, uint32_t id, char* buf, uint32_t cap);
int32_t na_load_wave_patch (NaApp*, uint32_t id, const char* json);
int32_t na_table_dirs (NaApp*, const char* paths);
int32_t na_wave_set (NaApp*, uint32_t id, const char* key, const char* json);
uint32_t na_table_frames (const char* name, float* out, uint32_t max);
uint64_t na_bad_blocks (NaApp*);

#ifdef __cplusplus
}
#endif
