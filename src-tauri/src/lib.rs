mod http_bridge;
mod python_sidecar;
mod sharkd_client;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sharkd_client::{Frame, InstallHealthStatus, SharkdClient, Status};
use std::sync::OnceLock;
use tauri::Emitter;

// Global sharkd client instance
static SHARKD: OnceLock<Mutex<Option<SharkdClient>>> = OnceLock::new();

fn get_sharkd() -> &'static Mutex<Option<SharkdClient>> {
    SHARKD.get_or_init(|| Mutex::new(None))
}

/// Response for load_pcap command
#[derive(Debug, Serialize, Deserialize)]
pub struct LoadResult {
    pub success: bool,
    pub frame_count: u64,
    pub duration: Option<f64>,
    pub error: Option<String>,
}

/// Response for get_frames command
#[derive(Debug, Serialize, Deserialize)]
pub struct FramesResult {
    pub frames: Vec<FrameData>,
    pub total: u64,
}

/// Simplified frame data for frontend
#[derive(Debug, Serialize, Deserialize)]
pub struct FrameData {
    pub number: u32,
    pub time: String,
    pub source: String,
    pub destination: String,
    pub protocol: String,
    pub length: String,
    pub info: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
}

impl From<Frame> for FrameData {
    fn from(frame: Frame) -> Self {
        // sharkd columns: Index 0: No., 1: Time, 2: Source, 3: Destination, 4: Protocol, 5: Length, 6: Info
        let cols = &frame.columns;
        FrameData {
            number: frame.number,
            time: cols.get(1).cloned().unwrap_or_default(),
            source: cols.get(2).cloned().unwrap_or_default(),
            destination: cols.get(3).cloned().unwrap_or_default(),
            protocol: cols.get(4).cloned().unwrap_or_default(),
            length: cols.get(5).cloned().unwrap_or_default(),
            info: cols.get(6).cloned().unwrap_or_default(),
            background: frame.background,
            foreground: frame.foreground,
        }
    }
}

/// Initialize sharkd (spawn the process)
#[tauri::command]
fn init_sharkd() -> Result<String, String> {
    let mut client_guard = get_sharkd().lock();

    if client_guard.is_some() {
        return Ok("Sharkd already initialized".to_string());
    }

    let client = SharkdClient::new()?;
    *client_guard = Some(client);

    Ok("Sharkd initialized successfully".to_string())
}

/// Load a PCAP file
#[tauri::command]
fn load_pcap(path: String) -> Result<LoadResult, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized. Call init_sharkd first.".to_string())?;

    // Load the file
    if let Err(e) = client.load(&path) {
        return Ok(LoadResult {
            success: false,
            frame_count: 0,
            duration: None,
            error: Some(e),
        });
    }

    // Get status to get frame count
    let status = client.status()?;

    Ok(LoadResult {
        success: true,
        frame_count: status.frames.unwrap_or(0),
        duration: status.duration,
        error: None,
    })
}

/// Get frames with pagination
#[tauri::command]
fn get_frames(skip: u32, limit: u32) -> Result<FramesResult, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized".to_string())?;

    let frames = client.frames(skip, limit)?;
    let status = client.status()?;

    Ok(FramesResult {
        frames: frames.into_iter().map(FrameData::from).collect(),
        total: status.frames.unwrap_or(0),
    })
}

/// Get current status
#[tauri::command]
fn get_status() -> Result<Status, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized".to_string())?;

    client.status()
}

/// Check if a display filter is valid
#[tauri::command]
fn check_filter(filter: String) -> Result<bool, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized".to_string())?;

    client.check_filter(&filter)
}

/// Validate a display filter and return the total frame count
/// Note: sharkd doesn't support global filter state - filters are per-request
#[tauri::command]
fn apply_filter(filter: String) -> Result<u64, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized".to_string())?;

    // Validate the filter
    if !filter.is_empty() && !client.check_filter(&filter)? {
        return Err("Invalid filter expression".to_string());
    }

    // Return total frame count (sharkd doesn't have global filter state)
    let status = client.status()?;
    Ok(status.frames.unwrap_or(0))
}

/// Get detailed frame information (protocol tree + hex bytes)
#[tauri::command]
fn get_frame_details(frame_num: u32) -> Result<serde_json::Value, String> {
    let client_guard = get_sharkd().lock();
    let client = client_guard
        .as_ref()
        .ok_or_else(|| "Sharkd not initialized".to_string())?;

    client.frame(frame_num)
}

// ============================================
// AI Sidecar Commands
// ============================================

/// Start the Python AI sidecar with config
#[tauri::command]
fn start_ai_sidecar(
    api_key: Option<String>,
    model: Option<String>,
) -> Result<python_sidecar::SidecarStatus, String> {
    let port = python_sidecar::spawn_python_sidecar_with_config(api_key, model)?;

    // Wait briefly for startup
    std::thread::sleep(std::time::Duration::from_millis(1000));

    let is_running = python_sidecar::check_python_sidecar();

    Ok(python_sidecar::SidecarStatus {
        is_running,
        port,
        version: Some("0.1.0".to_string()),
        error: if is_running {
            None
        } else {
            Some("Sidecar started but not responding yet".to_string())
        },
    })
}

/// Stop the Python AI sidecar
#[tauri::command]
fn stop_ai_sidecar() -> Result<(), String> {
    python_sidecar::stop_python_sidecar()
}

/// Get the status of the Python AI sidecar
#[tauri::command]
fn get_ai_sidecar_status() -> python_sidecar::SidecarStatus {
    python_sidecar::get_sidecar_status()
}

/// Validate local installation/runtime requirements for sharkd.
#[tauri::command]
fn get_install_health() -> InstallHealthStatus {
    sharkd_client::get_install_health()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            init_sharkd,
            load_pcap,
            get_frames,
            get_status,
            check_filter,
            apply_filter,
            get_frame_details,
            get_install_health,
            start_ai_sidecar,
            stop_ai_sidecar,
            get_ai_sidecar_status
        ])
        .setup(|app| {
            // Try to initialize sharkd on startup
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut client_guard = get_sharkd().lock();
                match SharkdClient::new() {
                    Ok(client) => {
                        *client_guard = Some(client);
                        println!("Sharkd initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("Warning: Failed to initialize sharkd: {}", e);
                        // Emit an event so frontend can show a message
                        let _ = app_handle.emit("sharkd-error", e);
                    }
                }
            });

            // Start HTTP bridge for Python sidecar communication
            std::thread::spawn(|| {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                rt.block_on(async {
                    if let Err(e) = http_bridge::start_http_bridge().await {
                        eprintln!("HTTP bridge error: {}", e);
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
