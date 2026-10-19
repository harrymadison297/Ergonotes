//! Phones and tablets do not run speech models on the device yet: the same commands, answering that they cannot.
//! The page asks `whisper_models` and treats an empty list as "not available here".

use serde::Serialize;
use tauri::ipc::Request;

#[derive(Default)]
pub struct WhisperState;

#[derive(Serialize)]
pub struct ModelInfo {}

#[derive(Serialize)]
pub struct Transcript {}

const NO: &str = "Speech-to-text on this device is not available yet.";

#[tauri::command]
pub fn whisper_models() -> Result<Vec<ModelInfo>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn whisper_download(_id: String) -> Result<(), String> {
    Err(NO.into())
}

#[tauri::command]
pub fn whisper_cancel_download() {}

#[tauri::command]
pub fn whisper_delete(_id: String) -> Result<(), String> {
    Err(NO.into())
}

#[tauri::command]
pub async fn whisper_transcribe(_request: Request<'_>) -> Result<Transcript, String> {
    Err(NO.into())
}

#[tauri::command]
pub fn whisper_cancel() {}
