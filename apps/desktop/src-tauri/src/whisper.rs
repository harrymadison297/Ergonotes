//! Speech-to-text on this computer: whisper.cpp (through whisper-rs) with a model the person downloads when they ask.
//!
//! The web view decodes the audio to 16 kHz mono and sends it as raw little-endian `f32`, so no audio codec lives here.
//! Models are the quantised ggml files of whisper.cpp on Hugging Face; the size and sha256 of each are fixed below, so
//! a download that was cut short or changed on the way is thrown away instead of loaded.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
/// A loaded model is dropped after this long without work: it holds hundreds of MB of memory.
const IDLE_UNLOAD: Duration = Duration::from_secs(300);

struct Model {
    id: &'static str,
    label: &'static str,
    file: &'static str,
    size: u64,
    sha256: &'static str,
}

const MODELS: [Model; 5] = [
    Model { id: "tiny", label: "Tiny: fastest, rough", file: "ggml-tiny-q5_1.bin", size: 32_152_673, sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7" },
    Model { id: "base", label: "Base: fast, fair", file: "ggml-base-q5_1.bin", size: 59_707_625, sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898" },
    Model { id: "small", label: "Small: good balance", file: "ggml-small-q5_1.bin", size: 190_085_487, sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb" },
    Model { id: "medium", label: "Medium: accurate, slower", file: "ggml-medium-q5_0.bin", size: 539_212_467, sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f" },
    Model { id: "large-turbo", label: "Large v3 turbo: most accurate", file: "ggml-large-v3-turbo-q5_0.bin", size: 574_041_195, sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2" },
];

fn find(id: &str) -> Result<&'static Model, String> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("Unknown speech model “{id}”."))
}

#[derive(Default)]
pub struct WhisperState {
    /// the model in memory, and the model it is
    loaded: Mutex<Option<(String, Arc<WhisperContext>)>>,
    last_used: Mutex<Option<Instant>>,
    /// one transcription at a time: whisper uses every core
    run: Arc<Mutex<()>>,
    abort: Arc<AtomicBool>,
    downloading: Mutex<Option<String>>,
    cancel_download: Arc<AtomicBool>,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("whisper"))
}

fn is_downloaded(dir: &std::path::Path, m: &Model) -> bool {
    fs::metadata(dir.join(m.file)).map(|f| f.len() == m.size).unwrap_or(false)
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: &'static str,
    label: &'static str,
    size: u64,
    downloaded: bool,
}

/// The engine is built for AVX2 (see `.cargo/config.toml`): on a processor without it, it would stop with an illegal instruction.
fn cpu_supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") && is_x86_feature_detected!("f16c")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        true
    }
}

#[tauri::command]
pub fn whisper_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    // an empty list is how the page learns that this computer cannot do it
    if !cpu_supported() {
        return Ok(Vec::new());
    }
    let dir = models_dir(&app)?;
    Ok(MODELS.iter().map(|m| ModelInfo { id: m.id, label: m.label, size: m.size, downloaded: is_downloaded(&dir, m) }).collect())
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    id: String,
    received: u64,
    total: u64,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn download(app: &AppHandle, cancel: &AtomicBool, m: &'static Model, dest: &std::path::Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        // a stalled connection ends; a slow one may take as long as it needs
        .read_timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client
        .get(format!("{BASE_URL}{}", m.file))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not download the model: {e}"))?;
    let part = dest.with_extension("part");
    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    let id = m.id.to_string();
    let result: Result<(), String> = async {
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Cancelled".to_string());
            }
            let Some(chunk) = res.chunk().await.map_err(|e| format!("The download stopped: {e}"))? else { break };
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            got += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(120) {
                last = Instant::now();
                let _ = app.emit("whisper-download", DownloadProgress { id: id.clone(), received: got, total: m.size });
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        if got != m.size || hex(&hasher.finalize_reset()) != m.sha256 {
            return Err("The downloaded file is damaged. Try again.".to_string());
        }
        Ok(())
    }
    .await;
    drop(file);
    match result {
        Ok(()) => fs::rename(&part, dest).map_err(|e| e.to_string()),
        Err(e) => {
            let _ = fs::remove_file(&part);
            Err(e)
        }
    }?;
    let _ = app.emit("whisper-download", DownloadProgress { id, received: m.size, total: m.size });
    Ok(())
}

#[tauri::command]
pub async fn whisper_download(app: AppHandle, state: State<'_, WhisperState>, id: String) -> Result<(), String> {
    let m = find(&id)?;
    let dir = models_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if is_downloaded(&dir, m) {
        return Ok(());
    }
    {
        let mut cur = state.downloading.lock().unwrap();
        if cur.is_some() {
            return Err("Another model is being downloaded.".into());
        }
        *cur = Some(id);
    }
    state.cancel_download.store(false, Ordering::Relaxed);
    let r = download(&app, &state.cancel_download, m, &dir.join(m.file)).await;
    *state.downloading.lock().unwrap() = None;
    r
}

#[tauri::command]
pub fn whisper_cancel_download(state: State<'_, WhisperState>) {
    state.cancel_download.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn whisper_delete(app: AppHandle, state: State<'_, WhisperState>, id: String) -> Result<(), String> {
    let m = find(&id)?;
    {
        let mut loaded = state.loaded.lock().unwrap();
        if loaded.as_ref().is_some_and(|(l, _)| l == &id) {
            *loaded = None;
        }
    }
    match fs::remove_file(models_dir(&app)?.join(m.file)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
pub struct Segment {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Serialize)]
pub struct Transcript {
    text: String,
    segments: Vec<Segment>,
}

/// 16 kHz mono `f32` samples from their little-endian bytes.
fn samples_of(raw: &[u8]) -> Result<Vec<f32>, String> {
    if raw.len() % 4 != 0 {
        return Err("The audio was not a whole number of samples.".into());
    }
    Ok(raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

fn transcribe(ctx: &WhisperContext, samples: &[f32], language: &str, abort: Arc<AtomicBool>, on_progress: impl FnMut(i32) + 'static) -> Result<Transcript, String> {
    let mut state = ctx.create_state().map_err(|e| format!("Could not start the speech model: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    // "auto" lets the model recognise the language; (`set_detect_language` would only detect it, and stop)
    params.set_language(Some(if language.is_empty() { "auto" } else { language }));
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    params.set_n_threads(cores.saturating_sub(1).clamp(1, 8) as i32);
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    // each window stands alone: a wrong phrase must not be carried into the next one
    params.set_no_context(true);
    params.set_suppress_nst(true);
    params.set_progress_callback_safe(on_progress);
    // whisper-rs 0.16's `set_abort_callback_safe` reads its closure through the wrong type and answers "abort" at once,
    // so the raw callback is used: the user data is the flag itself, which `abort` keeps alive until `full` returns
    unsafe extern "C" fn should_abort(flag: *mut std::ffi::c_void) -> bool {
        (*(flag as *const AtomicBool)).load(Ordering::Relaxed)
    }
    unsafe {
        params.set_abort_callback(Some(should_abort));
        params.set_abort_callback_user_data(Arc::as_ptr(&abort) as *mut std::ffi::c_void);
    }
    let ran = state.full(params, samples);
    if abort.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    ran.map_err(|e| format!("The speech model failed: {e}"))?;
    let mut segments = Vec::new();
    for seg in state.as_iter() {
        let text = seg.to_str_lossy().map_err(|e| e.to_string())?.trim().to_string();
        // empty, or a sound tag such as “[BLANK_AUDIO]” or “(music)”: not speech
        if text.is_empty() || (text.starts_with('[') && text.ends_with(']')) || (text.starts_with('(') && text.ends_with(')')) {
            continue;
        }
        // whisper counts in hundredths of a second
        segments.push(Segment { start: seg.start_timestamp() as f64 / 100.0, end: seg.end_timestamp() as f64 / 100.0, text });
    }
    let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    Ok(Transcript { text, segments })
}

fn context_for(state: &WhisperState, m: &Model, path: &std::path::Path) -> Result<Arc<WhisperContext>, String> {
    let mut loaded = state.loaded.lock().unwrap();
    if let Some((id, ctx)) = loaded.as_ref() {
        if id == m.id {
            return Ok(ctx.clone());
        }
    }
    // free the old model before reading the next one
    *loaded = None;
    let ctx = WhisperContext::new_with_params(path.to_str().ok_or("The model path is not valid text.")?, WhisperContextParameters::default())
        .map_err(|e| format!("Could not load the speech model: {e}"))?;
    let ctx = Arc::new(ctx);
    *loaded = Some((m.id.to_string(), ctx.clone()));
    Ok(ctx)
}

/// The body is the audio (raw `f32`, 16 kHz mono); the headers carry `x-model` and `x-language` (empty: recognise it).
#[tauri::command]
pub async fn whisper_transcribe(app: AppHandle, state: State<'_, WhisperState>, request: Request<'_>) -> Result<Transcript, String> {
    let InvokeBody::Raw(raw) = request.body() else { return Err("The audio must be sent as raw bytes.".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (model, language) = (header("x-model"), header("x-language"));
    if !cpu_supported() {
        return Err("This computer's processor is too old for speech-to-text on the device (it needs AVX2).".into());
    }
    let samples = samples_of(raw)?;
    let m = find(&model)?;
    let path = models_dir(&app)?.join(m.file);
    if !is_downloaded(path.parent().unwrap_or(&path), m) {
        return Err(format!("The speech model “{}” is not downloaded. Download it in Settings → AI.", m.id));
    }
    let ctx = context_for(&state, m, &path)?;
    let (abort, run) = (state.abort.clone(), state.run.clone());
    abort.store(false, Ordering::Relaxed);
    let worker_app = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let _one_at_a_time = run.lock().unwrap();
        transcribe(&ctx, &samples, &language, abort, move |pct| {
            let _ = worker_app.emit("whisper-progress", pct);
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.last_used.lock().unwrap() = Some(Instant::now());
    schedule_unload(app);
    Ok(out)
}

#[tauri::command]
pub fn whisper_cancel(state: State<'_, WhisperState>) {
    state.abort.store(true, Ordering::Relaxed);
}

/// Drops the model from memory once it has been idle for a while (the file stays; the next use loads it again).
fn schedule_unload(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(IDLE_UNLOAD + Duration::from_secs(1));
        let state = app.state::<WhisperState>();
        let idle = state.last_used.lock().unwrap().is_some_and(|t| t.elapsed() >= IDLE_UNLOAD);
        // a transcription in progress holds the run lock: leave the model alone then
        if idle && state.run.try_lock().is_ok() {
            *state.loaded.lock().unwrap() = None;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{hex, samples_of, MODELS};

    #[test]
    fn the_model_table_is_usable() {
        let mut ids: Vec<_> = MODELS.iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), MODELS.len());
        for m in &MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{}", m.id);
            assert!(m.file.ends_with(".bin") && m.size > 1_000_000, "{}", m.id);
        }
    }

    #[test]
    fn samples_are_read_little_endian() {
        let mut raw = Vec::new();
        for v in [0.5f32, -1.0, 0.0] {
            raw.extend_from_slice(&v.to_le_bytes());
        }
        assert_eq!(samples_of(&raw).unwrap(), vec![0.5, -1.0, 0.0]);
        assert!(samples_of(&raw[..5]).is_err());
    }

    /// Real speech through a real model: `WHISPER_TEST_MODEL=ggml-tiny-q5_1.bin WHISPER_TEST_WAV=jfk.wav cargo test whisper -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn a_real_sample_is_written_out() {
        use std::sync::{atomic::AtomicBool, Arc};
        let model = std::env::var("WHISPER_TEST_MODEL").expect("WHISPER_TEST_MODEL");
        let wav = std::fs::read(std::env::var("WHISPER_TEST_WAV").expect("WHISPER_TEST_WAV")).unwrap();
        // 16 kHz 16-bit mono WAV, 44-byte header
        let samples: Vec<f32> = wav[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let ctx = super::WhisperContext::new_with_params(&model, super::WhisperContextParameters::default()).unwrap();
        let out = super::transcribe(&ctx, &samples, "", Arc::new(AtomicBool::new(false)), |p| println!("progress {p}")).unwrap();
        println!("{} {:?}", out.text, out.segments.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>());
        assert!(out.text.to_lowercase().contains("ask not what your country"));
        // a stop asked for before it starts ends it as "Cancelled", and the next one runs
        let stopped = Arc::new(AtomicBool::new(true));
        assert_eq!(super::transcribe(&ctx, &samples, "", stopped, |_| {}).err().as_deref(), Some("Cancelled"));
        assert!(super::transcribe(&ctx, &samples, "", Arc::new(AtomicBool::new(false)), |_| {}).is_ok());
    }

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }
}
