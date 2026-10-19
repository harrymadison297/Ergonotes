# The desktop app can write speech out on its own computer

Amends ADR 0009 ("Writing it out uses a model of a custom server") and the private-note line of ADR 0008/0009 for this one
case. Speech-to-text had to be a server that speaks OpenAI's `/audio/transcriptions`. Most people have none, so dictation,
recordings and "Transcribe media" stayed off. The desktop app now runs Whisper itself.

## Decision

- **whisper.cpp inside the Rust shell** (`apps/desktop/src-tauri/src/whisper.rs`, the `whisper-rs` crate), Windows and Linux.
  It is built from source by cmake, so the builder image has cmake and libclang. Phones answer "not available" (the same
  commands, in `whisper_stub.rs`); they keep using a server until a mobile engine is chosen.
- **The person asks for a model; nothing is bundled.** Settings → AI → Speech-to-text → *On this computer* lists Tiny, Base,
  Small, Medium and Large v3 turbo (the quantised ggml files of `ggerganov/whisper.cpp` on Hugging Face, 32 MB to 574 MB).
  Download is one click, with progress and Cancel. The size and sha256 of each file are fixed in the code: a download that
  is short or different is deleted, never loaded. Files live in the app's local data folder (`…/whisper/`), outside the
  vault, so they are neither synced nor part of a backup. Delete removes the file.
- **The choice belongs to the device, not the vault.** It is in this device's `localStorage` (`ergo.localSpeech`: model and
  language), because the file exists here only; a synced setting would point a phone at a model it does not have. When a
  model is chosen, speech-to-text is ready with no server, and the server setting is left as it was. "A server" turns the
  local choice off.
- **The web view decodes, the shell infers.** `AudioContext.decodeAudioData` turns webm/opus, wav, mp3 or m4a into 16 kHz
  mono samples, which go to the shell as raw `f32` bytes (an hour is 230 MB, too much for JSON). The shell returns the text
  and the phrases with their times, the same `TimedTranscript` a server gives, so records, dictation and "Transcribe
  media" did not change. Records are already sent in 10-minute windows.
- **The model is loaded when first used and dropped after five idle minutes**, because it holds hundreds of MB. One
  transcription runs at a time (it uses every core but one). Cancel stops it between steps.
- **Language** is "recognise it" by default, with a list to fix it: a short or noisy window is sometimes taken for another
  language, and Vietnamese needs Small or larger to read well.

## Build and run requirements (learned by building it)

- **AVX2.** `apps/desktop/src-tauri/.cargo/config.toml` fixes whisper.cpp's CPU level at AVX2 + FMA + F16C. Left alone, ggml
  optimises for the build machine (an installer made on a new CPU crashes on an older one) or, when cross-compiling for
  Windows, for no vector instructions at all (measured: 5 times slower). `whisper.rs` checks for AVX2 at run time and
  offers no local speech on a processor without it (the option does not appear). Cargo does not rebuild `whisper-rs-sys`
  when this file changes: `cargo clean -p whisper-rs-sys --release --target …` first.
- **The Windows app ships the Visual C++ runtime** (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`, from
  `apps/desktop/src-tauri/vcruntime/`, beside the exe in the installer and in the portable zip). The engine is C++ and a
  clean Windows does not have them: without them the whole app failed to start. A static runtime was tried and does not
  link under cargo-xwin. Microsoft allows shipping these files with an app (app-local deployment).
- **The builder image** has cmake, ninja, libclang and LLVM 20 (Microsoft's STL needs Clang 19+ to compile C++ for the
  Windows target).
- **whisper-rs 0.16's `set_abort_callback_safe` is broken** (it reads its closure through the wrong type and answers "abort"
  at once: every run failed with "failed to encode", error -6). `whisper.rs` uses the raw callback with an `AtomicBool`.
  A test with a real model and a real sample (`--ignored`, see the test) covers it and Cancel.

## Measured

Windows 11 VM, 4 virtual cores of a Xeon Silver 4510T, 11 s of English speech: Tiny 2.8 s, Small 10 to 18 s (about real
time), model download 32 MB in 3 s and 190 MB in 9 s. A recording in webm/opus (what the recorder makes) decodes and is
written out correctly. Linux (the same engine) was run in the builder container only; its web view's webm/opus decoding
(GStreamer) is not verified.

## What did not change

A private note's audio is still not transcribed (ADR 0008): the rule stands until it is decided that audio which never
leaves the computer may be.

## Not done

Mobile (an Android engine: whisper.cpp through the NDK, or an ONNX runtime), GPU backends (Vulkan, CUDA, Metal), macOS,
progress outside the record player's Transcript button (dictation and the recorder's automatic transcript show none), and
letting a private note's audio be written out on this computer.
