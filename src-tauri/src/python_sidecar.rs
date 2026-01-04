//! Python sidecar process management.
//!
//! Handles spawning, monitoring, and stopping the Python FastAPI server
//! that powers the AI analysis features.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;

/// Global Python process instance
static PYTHON_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn get_python_process() -> &'static Mutex<Option<Child>> {
    PYTHON_PROCESS.get_or_init(|| Mutex::new(None))
}

/// Status of the Python sidecar
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarStatus {
    pub is_running: bool,
    pub port: u16,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Find a Python executable to use (prefers venv)
fn find_python(sidecar_path: &std::path::Path) -> Result<String, String> {
    // First try the venv Python in the sidecar directory
    let venv_python = sidecar_path
        .parent()
        .map(|p| p.join(".venv").join("bin").join("python"));

    if let Some(venv_path) = venv_python {
        if venv_path.exists() {
            return Ok(venv_path.to_string_lossy().to_string());
        }
    }

    // Fall back to system Python
    for cmd in ["python3", "python"] {
        let result = Command::new("which").arg(cmd).output();
        if let Ok(output) = result {
            if output.status.success() {
                return Ok(cmd.to_string());
            }
        }
    }
    Err("Python not found. Please install Python 3.11+".to_string())
}

/// Get the path to the sidecar directory
fn get_sidecar_path() -> Result<std::path::PathBuf, String> {
    // In development, sidecar is relative to the project root
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    println!("Current exe: {:?}", current_exe);

    // Try relative to current exe (target/debug/packet-pilot -> project root)
    // Go up: packet-pilot -> debug -> target -> src-tauri -> project root
    let mut path = current_exe.clone();
    for _ in 0..4 {
        if let Some(parent) = path.parent() {
            path = parent.to_path_buf();
            let sidecar_path = path.join("sidecar").join("src");
            println!("Trying path: {:?}", sidecar_path);
            if sidecar_path.exists() {
                return Ok(sidecar_path);
            }
        }
    }

    // Try from current working directory
    let cwd_path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("sidecar")
        .join("src");

    println!("Trying cwd path: {:?}", cwd_path);
    if cwd_path.exists() {
        return Ok(cwd_path);
    }

    // Try CARGO_MANIFEST_DIR for development
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let cargo_path = std::path::PathBuf::from(manifest_dir)
            .parent()
            .map(|p| p.join("sidecar").join("src"));

        if let Some(path) = cargo_path {
            println!("Trying cargo manifest path: {:?}", path);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    Err("Could not find sidecar directory".to_string())
}

/// Spawn the Python sidecar process with config
pub fn spawn_python_sidecar_with_config(
    api_key: Option<String>,
    model: Option<String>,
) -> Result<u16, String> {
    let mut guard = get_python_process().lock();

    // Check if already running
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, we can restart
                *guard = None;
            }
            Ok(None) => {
                // Still running
                return Ok(8765);
            }
            Err(e) => {
                eprintln!("Error checking process status: {}", e);
                *guard = None;
            }
        }
    }

    let sidecar_path = get_sidecar_path()?;
    let python_cmd = find_python(&sidecar_path)?;

    println!("Starting Python sidecar from: {:?}", sidecar_path);
    println!("Using Python: {}", python_cmd);

    let mut cmd = Command::new(&python_cmd);
    cmd.args([
        "-m",
        "uvicorn",
        "packet_pilot_ai.server:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8765",
    ])
    .current_dir(&sidecar_path)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    // Pass OpenRouter API key
    if let Some(key) = api_key {
        cmd.env("OPENROUTER_API_KEY", key);
    }

    if let Some(m) = model {
        cmd.env("AI_MODEL", m);
    }

    let process = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Python sidecar: {}", e))?;

    println!("Python sidecar spawned with PID: {}", process.id());
    *guard = Some(process);

    Ok(8765)
}

/// Spawn the Python sidecar process (legacy, no config)
pub fn spawn_python_sidecar() -> Result<u16, String> {
    spawn_python_sidecar_with_config(None, None)
}

/// Stop the Python sidecar process
pub fn stop_python_sidecar() -> Result<(), String> {
    let mut guard = get_python_process().lock();
    if let Some(mut process) = guard.take() {
        process
            .kill()
            .map_err(|e| format!("Failed to kill Python sidecar: {}", e))?;
        let _ = process.wait(); // Clean up zombie process
        println!("Python sidecar stopped");
    }
    Ok(())
}

/// Check if the Python sidecar is running and healthy
pub fn check_python_sidecar() -> bool {
    // Clean up tracked process if it has exited
    {
        let mut guard = get_python_process().lock();
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(Some(_)) => {
                    // Process has exited
                    *guard = None;
                }
                Ok(None) => {
                    // Process is still running
                }
                Err(_) => {
                    *guard = None;
                }
            }
        }
    }

    // HTTP health check - works regardless of how sidecar was started
    match std::process::Command::new("curl")
        .args([
            "-s",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "--max-time",
            "2",
            "http://127.0.0.1:8765/health",
        ])
        .output()
    {
        Ok(output) => {
            let status_code = String::from_utf8_lossy(&output.stdout);
            status_code.trim() == "200"
        }
        Err(_) => false,
    }
}

/// Get the current status of the Python sidecar
pub fn get_sidecar_status() -> SidecarStatus {
    let is_running = check_python_sidecar();

    SidecarStatus {
        is_running,
        port: 8765,
        version: if is_running {
            Some("0.1.0".to_string())
        } else {
            None
        },
        error: None,
    }
}
