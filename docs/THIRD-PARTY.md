# Third-party licences

*Generated from `cargo metadata` on 15 Aug 2026, with the development tooling
added by hand on 17 Aug. Regenerate whenever a dependency is added or bumped —
the command is at the bottom.*

This program links **190 third-party packages**. MIT and Apache-2.0 both
*require* attribution in distributed binaries, so this file discharges a legal
obligation rather than a courtesy — and it has to reach the user, in an About box
or a bundled NOTICES file or both. Shipping the binary without it is the actual
violation, not omitting the file from the repo.

## Status

**No GPL. No AGPL. Nothing here prevents selling a closed-source product.**

Two entries want a note:

- **`dyn-eq` — MPL-2.0.** Weak, file-level copyleft. Linking it into a closed
  product is explicitly permitted; the obligation attaches only if *its own files*
  are modified, and then only to those files. Do not modify it and this notice is
  the whole of the compliance.
- **`r-efi` — MIT OR Apache-2.0 OR LGPL-2.1-or-later.** A choice of three: take MIT
  or Apache and the LGPL branch never applies. A UEFI support crate, present only
  for a target that is not built.

## Before the first release

The table below is the part that is miserable to reconstruct later, which is why it
exists now. Two things still remain:

1. **Reproduce the full text of each distinct licence once** — MIT, Apache-2.0,
   BSD-2-Clause, BSD-3-Clause, Zlib, Unlicense, 0BSD, MPL-2.0, BlueOak-1.0.0,
   Unicode-3.0 — alongside this list.
2. **Collect per-crate copyright lines** from each package's own LICENSE file. MIT
   requires the copyright notice, not only the licence body.

## Not in the table — the bundled non-Rust assets

These ship inside the binary via `include_str!` and are invisible to
`cargo metadata`, so they have to be tracked by hand.

| asset | licence | what is owed |
|---|---|---|
| **p5.js 1.7.0** (`visualiser/p5.min.js`) | LGPL-2.1 | The vendored copy carries only a version banner, no licence text — that is a compliance gap today. LGPL permits use in a closed product, but the notice must ship and the user must be able to replace the library. Served as a standalone `/p5.min.js`, which helps. **Moot if the visuals go native** — one more thing the wgpu decision deletes. |
| **Poppins** (`visualiser/fonts.css`, base64) | SIL OFL 1.1 | Embedding and redistribution in a commercial product are expressly permitted. The OFL text and copyright must accompany it. No blocker. |
| **Lora** (same) | SIL OFL 1.1 | As above. |
| **YAMNet weights** (`models/yamnet.onnx`, 15 MB) | believed Apache-2.0 via `tensorflow/models` | **Verify before shipping.** The weights go inside a product being sold, and "believed" is not a standard to ship on. Note that AudioSet's own terms cover the *dataset*, not the trained model — do not confuse the two when checking. |

None of these blocks a sale. All four need a notice, and one — p5's missing
licence text — is a gap that exists right now.

## Not in the table — the development tooling

Nothing here ships. It is listed because "every dependency" should mean every
dependency, and because a reader who finds `package.json` in the repo deserves
to know why a program with no runtime has one.

| tool | licence | what it is for | ships? |
|---|---|---|---|
| **`@playwright/test` ^1.49** (1.62.1 installed) | Apache-2.0 | The 241 browser tests, and `tools/screenshots.mjs`, which takes the README's pictures from the running program | **No** |
| **Chromium**, via `playwright install` | BSD-3-Clause and others | The browser those tests drive. Downloaded to a cache outside the repo | **No** |

`package.json` exists for these alone. The application is one Rust binary with
no Node in it anywhere — `npm run check` and `npm run test:ui` are the only
things that use them, plus CI, which runs both.

Apache-2.0 requires attribution *in distributed binaries*. Neither of these is
distributed, so nothing is owed; they are here so that the sentence "this file
lists every dependency" stays true.

## Packages

| package | version | licence |
|---|---|---|
| `adler2` | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| `aho-corasick` | 1.1.5 | Unlicense OR MIT |
| `allocator-api2` | 0.2.21 | MIT OR Apache-2.0 |
| `alsa` | 0.11.0 | Apache-2.0/MIT |
| `alsa-sys` | 0.4.0 | MIT |
| `anyhow` | 1.0.104 | MIT OR Apache-2.0 |
| `anymap3` | 1.1.0 | BlueOak-1.0.0 OR MIT OR Apache-2.0 |
| `autocfg` | 1.5.1 | Apache-2.0 OR MIT |
| `bit-set` | 0.10.0 | Apache-2.0 OR MIT |
| `bit-vec` | 0.9.1 | Apache-2.0 OR MIT |
| `bitflags` | 2.13.1 | MIT OR Apache-2.0 |
| `block2` | 0.6.2 | MIT |
| `bumpalo` | 3.20.3 | MIT OR Apache-2.0 |
| `byteorder` | 1.5.0 | Unlicense OR MIT |
| `bytes` | 1.12.1 | MIT |
| `cc` | 1.4.2 | MIT OR Apache-2.0 |
| `cfg-if` | 1.0.4 | MIT OR Apache-2.0 |
| `chacha20` | 0.10.1 | MIT OR Apache-2.0 |
| `combine` | 4.6.7 | MIT |
| `coreaudio-rs` | 0.14.2 | MIT/Apache-2.0 |
| `cpal` | 0.18.1 | Apache-2.0 |
| `cpufeatures` | 0.3.0 | MIT OR Apache-2.0 |
| `crc32fast` | 1.5.0 | MIT OR Apache-2.0 |
| `crossbeam-deque` | 0.8.7 | MIT OR Apache-2.0 |
| `crossbeam-epoch` | 0.9.20 | MIT OR Apache-2.0 |
| `crossbeam-utils` | 0.8.22 | MIT OR Apache-2.0 |
| `crunchy` | 0.2.4 | MIT |
| `dasp_sample` | 0.11.0 | MIT OR Apache-2.0 |
| `derive-new` | 0.7.0 | MIT |
| `dispatch2` | 0.3.1 | Zlib OR Apache-2.0 OR MIT |
| `downcast-rs` | 2.0.2 | MIT OR Apache-2.0 |
| `dyn-clone` | 1.0.20 | MIT OR Apache-2.0 |
| `dyn-eq` | 0.1.3 | MPL-2.0 |
| `dyn-hash` | 1.0.0 | MIT OR Apache-2.0 |
| `either` | 1.17.0 | MIT OR Apache-2.0 |
| `equivalent` | 1.0.2 | Apache-2.0 OR MIT |
| `erased-serde` | 0.4.10 | MIT OR Apache-2.0 |
| `errno` | 0.3.14 | MIT OR Apache-2.0 |
| `fastrand` | 2.5.0 | Apache-2.0 OR MIT |
| `filetime` | 0.2.29 | MIT/Apache-2.0 |
| `find-msvc-tools` | 0.1.10 | MIT OR Apache-2.0 |
| `flate2` | 1.1.9 | MIT OR Apache-2.0 |
| `float-ord` | 0.3.2 | MIT / Apache-2.0 |
| `foldhash` | 0.2.0 | Zlib |
| `futures-core` | 0.3.33 | MIT OR Apache-2.0 |
| `futures-task` | 0.3.33 | MIT OR Apache-2.0 |
| `futures-util` | 0.3.33 | MIT OR Apache-2.0 |
| `getrandom` | 0.4.3 | MIT OR Apache-2.0 |
| `half` | 2.7.1 | MIT OR Apache-2.0 |
| `hashbrown` | 0.16.1 | MIT OR Apache-2.0 |
| `hashbrown` | 0.17.1 | MIT OR Apache-2.0 |
| `indexmap` | 2.14.0 | Apache-2.0 OR MIT |
| `inventory` | 0.3.24 | MIT OR Apache-2.0 |
| `itertools` | 0.14.0 | MIT OR Apache-2.0 |
| `itoa` | 1.0.18 | MIT OR Apache-2.0 |
| `jni` | 0.22.4 | MIT OR Apache-2.0 |
| `jni-macros` | 0.22.4 | MIT OR Apache-2.0 |
| `jni-sys` | 0.3.1 | MIT OR Apache-2.0 |
| `jni-sys` | 0.4.1 | MIT OR Apache-2.0 |
| `jni-sys-macros` | 0.4.1 | MIT OR Apache-2.0 |
| `js-sys` | 0.3.104 | MIT OR Apache-2.0 |
| `lazy_static` | 1.5.0 | MIT OR Apache-2.0 |
| `libc` | 0.2.189 | MIT OR Apache-2.0 |
| `libm` | 0.2.16 | MIT |
| `linux-raw-sys` | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `lock_api` | 0.4.14 | MIT OR Apache-2.0 |
| `log` | 0.4.33 | MIT OR Apache-2.0 |
| `mach2` | 0.6.0 | BSD-2-Clause OR MIT OR Apache-2.0 |
| `maplit` | 1.0.2 | MIT/Apache-2.0 |
| `matrixmultiply` | 0.3.11 | MIT/Apache-2.0 |
| `memchr` | 2.8.3 | Unlicense OR MIT |
| `memmap2` | 0.9.11 | MIT OR Apache-2.0 |
| `memo-map` | 0.3.3 | Apache-2.0 |
| `minijinja` | 2.23.0 | Apache-2.0 |
| `miniz_oxide` | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| `ndarray` | 0.17.2 | MIT OR Apache-2.0 |
| `ndk` | 0.9.0 | MIT OR Apache-2.0 |
| `ndk-context` | 0.1.1 | MIT OR Apache-2.0 |
| `ndk-sys` | 0.6.0+11769913 | MIT OR Apache-2.0 |
| `nom` | 8.0.0 | MIT |
| `nom-language` | 0.1.0 | MIT |
| `num-complex` | 0.4.6 | MIT OR Apache-2.0 |
| `num-derive` | 0.4.2 | MIT OR Apache-2.0 |
| `num-integer` | 0.1.46 | MIT OR Apache-2.0 |
| `num-traits` | 0.2.19 | MIT OR Apache-2.0 |
| `num_enum` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| `num_enum_derive` | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| `objc2` | 0.6.4 | MIT |
| `objc2-audio-toolbox` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-avf-audio` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-audio` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-audio-types` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-core-foundation` | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| `objc2-encode` | 4.1.0 | MIT |
| `objc2-foundation` | 0.3.2 | MIT |
| `once_cell` | 1.21.4 | MIT OR Apache-2.0 |
| `parking_lot` | 0.12.5 | MIT OR Apache-2.0 |
| `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 |
| `pastey` | 0.2.3 | MIT OR Apache-2.0 |
| `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT |
| `pkg-config` | 0.3.33 | MIT OR Apache-2.0 |
| `portable-atomic` | 1.14.0 | Apache-2.0 OR MIT |
| `portable-atomic-util` | 0.2.7 | Apache-2.0 OR MIT |
| `primal-check` | 0.3.4 | MIT OR Apache-2.0 |
| `proc-macro-crate` | 3.5.0 | MIT OR Apache-2.0 |
| `proc-macro2` | 1.0.107 | MIT OR Apache-2.0 |
| `prost` | 0.14.4 | Apache-2.0 |
| `prost-derive` | 0.14.4 | Apache-2.0 |
| `quote` | 1.0.47 | MIT OR Apache-2.0 |
| `r-efi` | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| `rand` | 0.10.2 | MIT OR Apache-2.0 |
| `rand_core` | 0.10.1 | MIT OR Apache-2.0 |
| `rand_distr` | 0.6.0 | MIT OR Apache-2.0 |
| `rawpointer` | 0.2.1 | MIT/Apache-2.0 |
| `rayon` | 1.12.0 | MIT OR Apache-2.0 |
| `rayon-core` | 1.13.0 | MIT OR Apache-2.0 |
| `redox_syscall` | 0.5.18 | MIT |
| `regex` | 1.13.1 | MIT OR Apache-2.0 |
| `regex-automata` | 0.4.18 | MIT OR Apache-2.0 |
| `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 |
| `rustc_version` | 0.4.1 | MIT OR Apache-2.0 |
| `rustfft` | 6.4.1 | MIT OR Apache-2.0 |
| `rustix` | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `rustversion` | 1.0.23 | MIT OR Apache-2.0 |
| `safetensors` | 0.8.0 | Apache-2.0 |
| `same-file` | 1.0.6 | Unlicense/MIT |
| `scan_fmt` | 0.2.6 | MIT |
| `scopeguard` | 1.2.0 | MIT OR Apache-2.0 |
| `semver` | 1.0.28 | MIT OR Apache-2.0 |
| `serde` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_core` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_derive` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 |
| `shlex` | 2.0.1 | MIT OR Apache-2.0 |
| `simd-adler32` | 0.3.10 | MIT |
| `simd_cesu8` | 1.2.0 | Apache-2.0 OR MIT |
| `simdutf8` | 0.1.5 | MIT OR Apache-2.0 |
| `slab` | 0.4.12 | MIT |
| `smallvec` | 1.15.2 | MIT OR Apache-2.0 |
| `strength_reduce` | 0.2.4 | MIT OR Apache-2.0 |
| `string-interner` | 0.20.0 | MIT/Apache-2.0 |
| `syn` | 2.0.119 | MIT OR Apache-2.0 |
| `syn` | 3.0.3 | MIT OR Apache-2.0 |
| `tar` | 0.4.46 | MIT OR Apache-2.0 |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 |
| `thiserror` | 1.0.69 | MIT OR Apache-2.0 |
| `thiserror` | 2.0.20 | MIT OR Apache-2.0 |
| `thiserror-impl` | 1.0.69 | MIT OR Apache-2.0 |
| `thiserror-impl` | 2.0.20 | MIT OR Apache-2.0 |
| `toml_datetime` | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_edit` | 0.25.13+spec-1.1.0 | MIT OR Apache-2.0 |
| `toml_parser` | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 |
| `tract-core` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-data` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-extra` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-hir` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-linalg` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-nnef` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-onnx` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-onnx-opl` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-pulse` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-pulse-opl` | 0.23.4 | MIT OR Apache-2.0 |
| `tract-transformers` | 0.23.4 | MIT OR Apache-2.0 |
| `transpose` | 0.2.3 | MIT OR Apache-2.0 |
| `typeid` | 1.0.3 | MIT OR Apache-2.0 |
| `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| `walkdir` | 2.5.0 | Unlicense/MIT |
| `wasm-bindgen` | 0.2.127 | MIT OR Apache-2.0 |
| `wasm-bindgen-macro` | 0.2.127 | MIT OR Apache-2.0 |
| `wasm-bindgen-macro-support` | 0.2.127 | MIT OR Apache-2.0 |
| `wasm-bindgen-shared` | 0.2.127 | MIT OR Apache-2.0 |
| `web-sys` | 0.3.104 | MIT OR Apache-2.0 |
| `winapi-util` | 0.1.11 | Unlicense OR MIT |
| `windows` | 0.62.2 | MIT OR Apache-2.0 |
| `windows-collections` | 0.3.2 | MIT OR Apache-2.0 |
| `windows-core` | 0.62.2 | MIT OR Apache-2.0 |
| `windows-future` | 0.3.2 | MIT OR Apache-2.0 |
| `windows-implement` | 0.60.2 | MIT OR Apache-2.0 |
| `windows-interface` | 0.59.3 | MIT OR Apache-2.0 |
| `windows-link` | 0.2.1 | MIT OR Apache-2.0 |
| `windows-numerics` | 0.3.1 | MIT OR Apache-2.0 |
| `windows-result` | 0.4.1 | MIT OR Apache-2.0 |
| `windows-strings` | 0.5.1 | MIT OR Apache-2.0 |
| `windows-sys` | 0.61.2 | MIT OR Apache-2.0 |
| `windows-threading` | 0.2.1 | MIT OR Apache-2.0 |
| `winnow` | 1.0.4 | MIT |
| `xattr` | 1.6.1 | MIT OR Apache-2.0 |
| `zerocopy` | 0.8.56 | BSD-2-Clause OR Apache-2.0 OR MIT |
| `zerocopy-derive` | 0.8.56 | BSD-2-Clause OR Apache-2.0 OR MIT |
| `zmij` | 1.0.23 | MIT |

---

Regenerate with:

    cargo metadata --format-version 1 --manifest-path core/Cargo.toml
