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
int32_t na_wave_wheel (NaApp*, uint32_t id, uint32_t which, float value);
uint32_t na_table_frames (const char* name, float* out, uint32_t max);
// Wave module id's side of MGL's /api/wave routes, as its server answers
// them: method "GET"/"POST"/"DELETE", path with any query, body the JSON or
// null. The JSON reply into buf; *status the HTTP status MGL would answer.
// A reply too long for buf is kept whole: na_wave_reply gives it (asking
// again would do a POST twice).
uint32_t na_wave_api (NaApp*, uint32_t id, const char* method, const char* path, const char* body, char* buf, uint32_t cap, int32_t* status);
uint32_t na_wave_reply (NaApp*, char* buf, uint32_t cap);
// Wave's own folders: presets in <home>/presets/wave, board presets in
// <home>/presets/wave-boards; mgl is MGL's data/wave, read only (null for
// MGL's own on this machine, "" for none). Tables go in the first
// na_table_dirs folder.
int32_t na_set_wave_home (NaApp*, const char* home, const char* mgl);
uint64_t na_bad_blocks (NaApp*);

// Atmosphere: its state by the page's own keys (knob ids at raw values,
// select values, "fx" the chain; "fx.<slot>.<key>|wet|level|on" one control
// of the running chain). Unknown keys are ignored (0).
int32_t na_atmos_set (NaApp*, uint32_t id, const char* key, const char* json);
uint32_t na_atmos_state (NaApp*, uint32_t id, char* buf, uint32_t cap);
// As one of MGL's presets (only Atmosphere's controls), named; and back:
// how many controls a preset set, or an error.
uint32_t na_atmos_preset (NaApp*, uint32_t id, const char* name, char* buf, uint32_t cap);
int32_t na_load_atmos_preset (NaApp*, uint32_t id, const char* json);
// Oscillator which (0 A, 1 B): 32 floats; returns the model's number or -1.
int32_t na_atmos_view (NaApp*, uint32_t id, uint32_t which, float* out32);
float na_atmos_hz (NaApp*, uint32_t id);
// The last n frames (at most 2048) of its output, mono, oldest first; how many.
uint32_t na_atmos_scope (NaApp*, uint32_t id, float* out, uint32_t n);
// The FX line since the last call: output peak, and per chain slot its peak
// and how hard it works; returns the chain's length.
uint32_t na_atmos_fx_meter (NaApp*, uint32_t id, float* peak, float* peaks, float* work, uint32_t n);
// The insert menu's effects ({suites, shapers}, as atfx.js keeps /api/fx).
uint32_t na_fx_kinds (char* buf, uint32_t cap);
// The page's own lists (data/atmos-page.json).
uint32_t na_atmos_page (char* buf, uint32_t cap);

// The Sound module: a file opened (origin: {"kind": "file"|"library", "path",
// "name"}; keep 1 takes back a lost sound's edits), and what it holds (MGL's
// /api/edit answer, its origin, its markers). Its info into buf, or an error.
int32_t na_sound_open (NaApp*, uint32_t id, const char* path, const char* origin, uint32_t keep, char* buf, uint32_t cap);
int32_t na_sound_info (NaApp*, uint32_t id, char* buf, uint32_t cap);
// Its whole timeline in up to cols columns: channel 1's mins then maxes; the columns.
int32_t na_sound_peaks (NaApp*, uint32_t id, uint32_t cols, float* out);
// The Sound module cabled into Edit module id, or -2.
int32_t na_sound_of (NaApp*, uint32_t edit);

// Edit, on the sound cabled into it. Text answers return their length, or an
// error code. An op is MGL's /api/edit message; annot is /api/markers'
// ({"op":"set",...}) or /api/annot's.
int32_t na_edit_op (NaApp*, uint32_t id, const char* json, char* buf, uint32_t cap);
int32_t na_edit_annot (NaApp*, uint32_t id, const char* json, char* buf, uint32_t cap);
int32_t na_edit_measure (NaApp*, uint32_t id, uint64_t start, uint64_t end, char* buf, uint32_t cap);
// The page's own measures (hits, loud, bands and levels of [from, to)), null until made.
int32_t na_edit_measures (NaApp*, uint32_t id, double from, double to, char* buf, uint32_t cap);
// Peaks of the edited timeline: [channel][min, max, rms][column]; info: channels, from, to.
int32_t na_edit_peaks (NaApp*, uint32_t id, uint64_t from, uint64_t to, uint32_t cols, float* out, uint32_t cap, uint64_t* info3);
// The file's spectrogram, a byte a cell, column by column; info: bins, maxHz.
int32_t na_edit_spectrogram (NaApp*, uint32_t id, uint64_t from, uint64_t to, uint32_t cols, uint32_t fft, uint8_t* out, uint32_t cap, float* info2);
// Rainbow colours, r g b per column; 1, or 0 until measured.
int32_t na_edit_colours (NaApp*, uint32_t id, double from, double to, uint32_t cols, float* out);
// Mono samples from `from`; the sound's length, 0 until measured.
int64_t na_edit_mono (NaApp*, uint32_t id, int64_t from, float* out, uint32_t n);
int64_t na_edit_edge_snap (NaApp*, uint32_t id, int64_t frame, uint32_t hits, uint32_t zero);
// {"play":bool} {"seek":frame} {"loop":{"on","a","b"}}; frames on the document.
int32_t na_edit_transport (NaApp*, uint32_t id, const char* json);
// frame, playing, peak l, peak r
int32_t na_edit_position (NaApp*, uint32_t id, double* out4);
int64_t na_edit_export (NaApp*, uint32_t id, const char* path, uint32_t bits);
int32_t na_edit_set_ui (NaApp*, uint32_t id, const char* json);
int32_t na_edit_ui (NaApp*, uint32_t id, char* buf, uint32_t cap);

// Grain, on the sound cabled into it (or its own start sound). `what` names
// the route it stands for: "edit" (an /api/edit op on its document), "keys"
// (/api/engine/voice), "transport", "lfos", "lfos-state", "rack", "presets",
// "info", "read" (/api/engine/grains), "ui". JSON in and out.
int32_t na_grain_call (NaApp*, uint32_t id, const char* what, const char* json, char* buf, uint32_t cap);
// Every Grain's LFOs on by `seconds` (MGL ticks them every 8 ms).
void na_grain_tick (NaApp*, double seconds);
int32_t na_grain_peaks (NaApp*, uint32_t id, uint64_t from, uint64_t to, uint32_t cols, float* out, uint32_t cap, uint64_t* info3);
int64_t na_grain_mono (NaApp*, uint32_t id, uint64_t from, float* out, uint32_t n);
int32_t na_grain_scope (NaApp*, uint32_t id, float* l, float* r, uint32_t n);

#ifdef __cplusplus
}
#endif
