use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

/// Frame data returned from sharkd
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    #[serde(rename = "c")]
    pub columns: Vec<String>,
    #[serde(rename = "num")]
    pub number: u32,
    #[serde(rename = "bg", default)]
    pub background: Option<String>,
    #[serde(rename = "fg", default)]
    pub foreground: Option<String>,
}

/// Status response from sharkd
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub frames: Option<u64>,
    pub duration: Option<f64>,
    pub filename: Option<String>,
}

/// Frames response from sharkd
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FramesResponse {
    pub frames: Vec<Frame>,
}

/// Generic JSON-RPC response
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: u64,
    result: Option<Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

pub struct SharkdClient {
    #[allow(dead_code)]
    process: Child,
    stdin: Mutex<ChildStdin>,
    stdout: Mutex<BufReader<ChildStdout>>,
    request_id: AtomicU64,
}

/// Get the target triple for the current platform
fn get_target_triple() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "x86_64-unknown-linux-gnu";

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "aarch64-unknown-linux-gnu";

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "x86_64-apple-darwin";

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "aarch64-apple-darwin";

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "x86_64-pc-windows-msvc";

    #[cfg(not(any(
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    return "unknown";
}

/// Find the sharkd binary - tries sidecar first, then system PATH
fn find_sharkd() -> Result<PathBuf, String> {
    // First check if system sharkd exists and use it directly
    // This avoids issues with wrapper scripts not passing stdout correctly
    if let Ok(output) = std::process::Command::new("which").arg("sharkd").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                println!("Using system sharkd: {}", path);
                return Ok(PathBuf::from(path));
            }
        }
    }

    // Try to find the bundled sidecar
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let target_triple = get_target_triple();

            // Sidecar naming convention: name-target_triple[.exe]
            #[cfg(target_os = "windows")]
            let sidecar_name = format!("sharkd-{}.exe", target_triple);
            #[cfg(not(target_os = "windows"))]
            let sidecar_name = format!("sharkd-{}", target_triple);

            let sidecar_path = exe_dir.join(&sidecar_name);

            if sidecar_path.exists() {
                println!("Found bundled sharkd at: {:?}", sidecar_path);
                return Ok(sidecar_path);
            }
        }
    }

    Err("Sharkd not found. Please install Wireshark.".to_string())
}

impl SharkdClient {
    /// Spawn a new sharkd process in stdio mode
    pub fn new() -> Result<Self, String> {
        let sharkd_path = find_sharkd()?;

        println!("Spawning sharkd from: {:?}", sharkd_path);

        let mut process = Command::new(&sharkd_path)
            .arg("-") // stdio mode
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()) // Capture stderr for debugging
            .spawn()
            .map_err(|e| {
                format!(
                    "Failed to spawn sharkd at {:?}: {}. \n\
                    Please ensure Wireshark is installed and sharkd is in your PATH, \n\
                    or place the sharkd binary in the binaries/ folder.",
                    sharkd_path, e
                )
            })?;

        println!("Sharkd process spawned with PID: {:?}", process.id());

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| "Failed to get sharkd stdin".to_string())?;

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "Failed to get sharkd stdout".to_string())?;

        let client = SharkdClient {
            process,
            stdin: Mutex::new(stdin),
            stdout: Mutex::new(BufReader::new(stdout)),
            request_id: AtomicU64::new(1),
        };

        // Note: "Hello in child." goes to stderr, not stdout
        // Verify sharkd is working by sending a status request
        println!("Sending status request to sharkd...");
        let status = client.send_request("status", None)?;
        if status.get("frames").is_some() || status.get("columns").is_some() {
            println!("Sharkd initialized successfully");
            return Ok(client);
        }

        Err("Failed to verify sharkd is working".to_string())
    }

    /// Read a raw line from stdout
    fn read_line(&self) -> Result<String, String> {
        let mut stdout = self.stdout.lock();
        let mut line = String::new();
        stdout
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read from sharkd: {}", e))?;
        Ok(line)
    }

    /// Send a JSON-RPC request and return the result
    fn send_request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let request = if let Some(p) = params {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": p
            })
        } else {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method
            })
        };

        // CRITICAL: sharkd requires newline-delimited JSON
        let request_str = format!("{}\n", request.to_string());

        {
            let mut stdin = self.stdin.lock();
            stdin
                .write_all(request_str.as_bytes())
                .map_err(|e| format!("Failed to write to sharkd: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush sharkd stdin: {}", e))?;
        }

        let response: JsonRpcResponse = serde_json::from_value(self.read_response()?)
            .map_err(|e| format!("Failed to parse sharkd response: {}", e))?;

        if let Some(error) = response.error {
            return Err(format!("Sharkd error {}: {}", error.code, error.message));
        }

        response
            .result
            .ok_or_else(|| "No result in sharkd response".to_string())
    }

    /// Read a line from stdout and parse as JSON
    fn read_response(&self) -> Result<Value, String> {
        let mut stdout = self.stdout.lock();
        let mut line = String::new();
        stdout
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read from sharkd: {}", e))?;

        serde_json::from_str(&line).map_err(|e| format!("Failed to parse JSON from sharkd: {}", e))
    }

    /// Load a PCAP file
    pub fn load(&self, file_path: &str) -> Result<(), String> {
        println!("Loading file: {}", file_path);
        let result = self.send_request("load", Some(json!({ "file": file_path })))?;
        println!("Load result: {:?}", result);

        // Check if load was successful
        // sharkd returns {"status":"OK"} on success or {"err": code} on failure
        if let Some(status) = result.get("status") {
            if status.as_str() == Some("OK") {
                println!("File loaded successfully");
                return Ok(());
            }
        }

        if let Some(err) = result.get("err") {
            return Err(format!("Failed to load file: error code {}", err));
        }

        // If we got here with no error, assume success
        Ok(())
    }

    /// Get the current status (frame count, duration, etc.)
    pub fn status(&self) -> Result<Status, String> {
        let result = self.send_request("status", None)?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse status: {}", e))
    }

    /// Get frames with pagination
    pub fn frames(&self, skip: u32, limit: u32) -> Result<Vec<Frame>, String> {
        let params = if skip > 0 {
            json!({
                "skip": skip,
                "limit": limit
            })
        } else {
            json!({
                "limit": limit
            })
        };

        let result = self.send_request("frames", Some(params))?;

        // sharkd returns frames as an array directly
        let frames: Vec<Frame> =
            serde_json::from_value(result).map_err(|e| format!("Failed to parse frames: {}", e))?;

        Ok(frames)
    }

    /// Get detailed information about a specific frame (protocol tree)
    pub fn frame(&self, frame_num: u32) -> Result<Value, String> {
        self.send_request(
            "frame",
            Some(json!({
                "frame": frame_num,
                "proto": true,
                "bytes": true
            })),
        )
    }

    /// Get the hex dump of a specific frame
    pub fn frame_bytes(&self, frame_num: u32) -> Result<Value, String> {
        self.send_request(
            "frame",
            Some(json!({
                "frame": frame_num,
                "bytes": true
            })),
        )
    }

    /// Check if a display filter is valid
    pub fn check_filter(&self, filter: &str) -> Result<bool, String> {
        let result = self.send_request("check", Some(json!({ "filter": filter })))?;

        // If there's an "err" field, the filter is invalid
        Ok(result.get("err").is_none())
    }

    /// Set a display filter and get matching frames
    pub fn set_filter(&self, filter: &str) -> Result<(), String> {
        let result = self.send_request("setfilter", Some(json!({ "filter": filter })))?;

        if let Some(err) = result.get("err") {
            if err.as_i64() != Some(0) {
                return Err(format!("Failed to set filter: {:?}", err));
            }
        }

        Ok(())
    }
}
