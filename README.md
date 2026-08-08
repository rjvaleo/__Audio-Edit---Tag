# Audio Edit & Tag

Browse, audition, tag and edit a large audio library without moving or renaming a
single audio file. Tags and edits are sidecar data; **the original audio is never
written to**. Rendering happens only when you explicitly export.

## Start here

| | |
|---|---|
| **macOS** | double-click **`Start.command`** |
| **Windows** | double-click **`StartHere.bat`** |

Either one starts a small local server and opens your browser at
`http://127.0.0.1:8737/`. Nothing else needs installing — no Python, no runtime.
Close the window or press Ctrl-C to stop it.

On the first run it opens on the bundled `Audio Library` folder. After that it
remembers whichever library you pick, and you can change it any time from the
Library tab.

## Layout

    Start.command     macOS launcher
    StartHere.bat     Windows launcher
    bin/              the prebuilt programs — audiolab (macOS), audiolab.exe (Windows)
    data/             everything the app remembers. Not in git; see below
    core/             the Rust source
    ui/               the interface, embedded into the binary at build time
    Audio Library/    sample audio to try it on
    Reference Docs/   papers and the classification taxonomy

## Where your work is kept

Everything the app remembers lives in **`data/`**, beside the launcher — the
chosen library path, tag overrides, markers, presets, saved sessions and the
scan index. It is deliberately *not* under `core/target`, because
`cargo build --release` output gets cleaned and would take your work with it.

`data/` is not tracked in git; it is per-machine, and the library path differs
between the Mac and the PC.

## Building from source

Rust only — the workspace has **no external crate dependencies**, so there is no
C toolchain to install and no dependency tree to resolve.

    cargo build --release --manifest-path core/Cargo.toml     # this machine
    cargo test --release --manifest-path core/Cargo.toml      # 322 tests

For the Windows build from a Mac, once per machine:

    rustup target add x86_64-pc-windows-gnu
    brew install mingw-w64

then

    cargo build --release --manifest-path core/Cargo.toml --target x86_64-pc-windows-gnu
    cp core/target/x86_64-pc-windows-gnu/release/audiolab.exe bin/

**The interface is embedded into the binary** with `include_str!`. After editing
anything in `ui/`, rebuild — otherwise the browser is served the old file.

## Worth knowing

- **Nothing here renames, moves or overwrites audio.** Edits are an edit list —
  clips referencing ranges of the source — so cutting an hour costs two
  integers. Export is the only thing that writes audio, and it writes a new file.
- **Provenance is shown, not hidden.** Values are marked measured, inferred or
  guessed, because a lot of this library is headerless PCM where the truth has
  to be reconstructed.
- **Mono vs dual-mono stereo cannot be determined from raw PCM** — both give an
  identical 0.5 delta ratio. Headerless channel counts come from neighbouring
  headered files instead.
- **The waveform is sample accurate when zoomed in.** Past the point where there
  are more pixels than samples, the display stops being a min/max summary and
  draws the samples themselves; the zoom readout switches to `n smp` to say so.
