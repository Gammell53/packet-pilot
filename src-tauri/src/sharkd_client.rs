use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
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

/// Stream payload segment from sharkd follow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamPayload {
    /// Byte count for this segment
    pub n: u64,
    /// Base64-encoded data
    pub d: String,
    /// Direction: 0 = client->server, 1 = server->client
    pub s: u8,
}

/// Stream data returned from sharkd follow command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamData {
    /// Server host
    #[serde(default)]
    pub shost: String,
    /// Server port
    #[serde(default)]
    pub sport: String,
    /// Client host
    #[serde(default)]
    pub chost: String,
    /// Client port
    #[serde(default)]
    pub cport: String,
    /// Server bytes total
    #[serde(default)]
    pub sbytes: u64,
    /// Client bytes total
    #[serde(default)]
    pub cbytes: u64,
    /// Payload segments
    #[serde(default)]
    pub payloads: Vec<StreamPayload>,
}

/// Protocol hierarchy node from tap phs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolNode {
    /// Protocol name
    #[serde(rename = "proto")]
    pub protocol: String,
    /// Frame count for this protocol
    #[serde(default)]
    pub frames: u64,
    /// Byte count for this protocol
    #[serde(default)]
    pub bytes: u64,
    /// Child protocols
    #[serde(rename = "protos", default)]
    pub children: Vec<ProtocolNode>,
}

/// Conversation from tap conv
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    /// Source address
    #[serde(default)]
    pub saddr: String,
    /// Destination address
    #[serde(default)]
    pub daddr: String,
    /// Source port
    #[serde(default)]
    pub sport: Option<String>,
    /// Destination port
    #[serde(default)]
    pub dport: Option<String>,
    /// Received frames
    #[serde(default)]
    pub rxf: u64,
    /// Received bytes
    #[serde(default)]
    pub rxb: u64,
    /// Transmitted frames
    #[serde(default)]
    pub txf: u64,
    /// Transmitted bytes
    #[serde(default)]
    pub txb: u64,
    /// Start time
    #[serde(default)]
    pub start: Option<f64>,
    /// Stop time
    #[serde(default)]
    pub stop: Option<f64>,
    /// Filter to select this conversation
    #[serde(default)]
    pub filter: Option<String>,
}

/// Endpoint from tap host
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    /// Host address
    #[serde(default)]
    pub host: String,
    /// Port (if applicable)
    #[serde(default)]
    pub port: Option<String>,
    /// Received frames
    #[serde(default)]
    pub rxf: u64,
    /// Received bytes
    #[serde(default)]
    pub rxb: u64,
    /// Transmitted frames
    #[serde(default)]
    pub txf: u64,
    /// Transmitted bytes
    #[serde(default)]
    pub txb: u64,
    /// Filter to select this endpoint
    #[serde(default)]
    pub filter: Option<String>,
}

/// Tap result item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapResultItem {
    /// Tap name
    pub tap: String,
    /// Tap type
    #[serde(rename = "type")]
    pub tap_type: String,
    /// Protocol hierarchy (for phs tap)
    #[serde(default)]
    pub proto: Vec<ProtocolNode>,
    /// Conversations (for conv tap)
    #[serde(default)]
    pub convs: Vec<Conversation>,
    /// Endpoints (for host tap)
    #[serde(default)]
    pub hosts: Vec<Endpoint>,
}

/// Complete capture statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CaptureStats {
    pub protocol_hierarchy: Vec<ProtocolNode>,
    pub tcp_conversations: Vec<Conversation>,
    pub udp_conversations: Vec<Conversation>,
    pub endpoints: Vec<Endpoint>,
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

/// Installation issue returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallIssue {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Install/runtime health status returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallHealthStatus {
    pub ok: bool,
    pub issues: Vec<InstallIssue>,
    pub checked_paths: Vec<String>,
    pub recommended_action: String,
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

fn is_production_mode(exe_path: &Path) -> bool {
    let path_str = exe_path.to_string_lossy();
    !path_str.contains("target/debug") && !path_str.contains("target/release")
}

fn bundled_sharkd_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let target = get_target_triple();
    #[cfg(target_os = "windows")]
    {
        vec![
            exe_dir.join(format!("sharkd-{}.exe", target)),
            // Compatibility fallback for old builds.
            exe_dir.join("sharkd.exe"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            exe_dir.join(format!("sharkd-wrapper-{}", target)),
            exe_dir.join(format!("sharkd-{}", target)),
            // Compatibility fallback for older packaging.
            exe_dir.join("sharkd"),
        ]
    }
}

#[cfg(target_os = "windows")]
fn add_windows_path_candidates(paths: &mut Vec<PathBuf>, debug_info: &mut Vec<String>) {
    // Prefer PATH detection in both dev and production fallback mode.
    match Command::new("where").arg("sharkd").output() {
        Ok(output) if output.status.success() => {
            let found = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from)
                .collect::<Vec<_>>();
            if found.is_empty() {
                debug_info.push("'where sharkd' succeeded but returned no paths".to_string());
            } else {
                debug_info.push(format!("'where sharkd' found {} path(s)", found.len()));
                paths.extend(found);
            }
        }
        Ok(_) => debug_info.push("'where sharkd' did not find sharkd in PATH".to_string()),
        Err(e) => debug_info.push(format!("Failed to execute 'where sharkd': {}", e)),
    }

    for p in [
        r"C:\Program Files\Wireshark\sharkd.exe",
        r"C:\Program Files (x86)\Wireshark\sharkd.exe",
    ] {
        paths.push(PathBuf::from(p));
    }
}

fn system_sharkd_candidates(debug_info: &mut Vec<String>) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        add_windows_path_candidates(&mut paths, debug_info);
    }

    #[cfg(not(target_os = "windows"))]
    {
        match Command::new("which").arg("sharkd").output() {
            Ok(output) if output.status.success() => {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    paths.push(PathBuf::from(path));
                } else {
                    debug_info.push("'which sharkd' returned empty output".to_string());
                }
            }
            Ok(_) => debug_info.push("'which sharkd' did not find sharkd in PATH".to_string()),
            Err(e) => debug_info.push(format!("Failed to execute 'which sharkd': {}", e)),
        }
    }

    let mut unique = BTreeSet::new();
    paths
        .into_iter()
        .filter(|p| unique.insert(p.clone()))
        .collect::<Vec<_>>()
}

#[cfg(target_os = "windows")]
fn windows_required_runtime_files() -> Vec<&'static str> {
    vec![
        "libwireshark.dll",
        "libwiretap.dll",
        "libwsutil.dll",
        "libglib-2.0-0.dll",
        "libgcrypt-20.dll",
    ]
}

#[cfg(target_os = "windows")]
fn validate_windows_runtime(exe_dir: &Path, sharkd_path: &Path) -> Vec<InstallIssue> {
    let mut issues = Vec::new();

    if !sharkd_path.exists() {
        issues.push(InstallIssue {
            code: "missing_sharkd".to_string(),
            message: "Bundled sharkd executable is missing.".to_string(),
            path: Some(sharkd_path.display().to_string()),
        });
        return issues;
    }

    for file in windows_required_runtime_files() {
        let p = exe_dir.join(file);
        if !p.exists() {
            issues.push(InstallIssue {
                code: "missing_dependency".to_string(),
                message: format!("Required runtime library is missing: {}", file),
                path: Some(p.display().to_string()),
            });
        }
    }

    // Common mismatch from some Wireshark distributions.
    if exe_dir.join("glib-2.0-0.dll").exists() && !exe_dir.join("libglib-2.0-0.dll").exists() {
        issues.push(InstallIssue {
            code: "invalid_bundle".to_string(),
            message: "Found glib-2.0-0.dll but missing libglib-2.0-0.dll expected by bundled sharkd.".to_string(),
            path: Some(exe_dir.display().to_string()),
        });
    }

    issues
}

#[cfg(not(target_os = "windows"))]
fn validate_windows_runtime(_exe_dir: &Path, _sharkd_path: &Path) -> Vec<InstallIssue> {
    Vec::new()
}

fn find_sharkd_with_debug() -> Result<(PathBuf, Vec<String>), String> {
    let mut debug_info = vec!["=== Sharkd Detection Debug ===".to_string()];

    let mut exe_dir: Option<PathBuf> = None;
    let mut is_production = false;
    match std::env::current_exe() {
        Ok(exe_path) => {
            is_production = is_production_mode(&exe_path);
            debug_info.push(format!("Current executable: {:?}", exe_path));
            debug_info.push(format!("Is production mode: {}", is_production));
            exe_dir = exe_path.parent().map(PathBuf::from);
            if let Some(dir) = &exe_dir {
                debug_info.push(format!("Executable directory: {:?}", dir));
                debug_info.push(format!("Target triple: {}", get_target_triple()));
            }
        }
        Err(e) => debug_info.push(format!("Failed to get current executable: {}", e)),
    }

    if let Some(dir) = &exe_dir {
        if let Ok(entries) = std::fs::read_dir(dir) {
            let files: Vec<String> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            debug_info.push(format!(
                "Files in exe_dir ({} total): {:?}",
                files.len(),
                files.iter().take(20).collect::<Vec<_>>()
            ));
            if files.len() > 20 {
                debug_info.push(format!("  ... and {} more files", files.len() - 20));
            }
        }
    }

    if is_production {
        if let Some(dir) = &exe_dir {
            for candidate in bundled_sharkd_candidates(dir) {
                let exists = candidate.exists();
                debug_info.push(format!(
                    "Checking bundled path: {:?} (exists: {})",
                    candidate, exists
                ));
                if exists {
                    println!("{}", debug_info.join("\n"));
                    println!("Using bundled sharkd at: {:?}", candidate);
                    return Ok((candidate, debug_info));
                }
            }
        }
    } else {
        debug_info.push("Development mode - bundled path checks are optional".to_string());
    }

    debug_info.push("Falling back to system sharkd discovery...".to_string());
    for candidate in system_sharkd_candidates(&mut debug_info) {
        let exists = candidate.exists();
        debug_info.push(format!(
            "Checking system path: {:?} (exists: {})",
            candidate, exists
        ));
        if exists {
            println!("{}", debug_info.join("\n"));
            println!("Using system sharkd: {:?}", candidate);
            return Ok((candidate, debug_info));
        }
    }

    let debug_output = debug_info.join("\n");
    eprintln!("{}", debug_output);
    Err(format!(
        "Sharkd not found. PacketPilot expects bundled sharkd or a Wireshark install with sharkd in PATH.\n\nDebug info:\n{}",
        debug_output
    ))
}

/// Find the sharkd binary path.
fn find_sharkd() -> Result<PathBuf, String> {
    let (path, _debug) = find_sharkd_with_debug()?;
    Ok(path)
}

/// Get install/runtime health details for startup diagnostics.
pub fn get_install_health() -> InstallHealthStatus {
    let mut issues = Vec::new();
    let mut checked_paths = Vec::new();

    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
    let is_production = exe_path
        .as_ref()
        .map(|p| is_production_mode(p))
        .unwrap_or(false);

    if let Some(dir) = &exe_dir {
        for p in bundled_sharkd_candidates(dir) {
            checked_paths.push(p.display().to_string());
        }
    }

    let mut debug = Vec::new();
    for p in system_sharkd_candidates(&mut debug) {
        checked_paths.push(p.display().to_string());
    }

    let sharkd_path = match find_sharkd_with_debug() {
        Ok((path, _)) => path,
        Err(e) => {
            issues.push(InstallIssue {
                code: "missing_sharkd".to_string(),
                message: "Could not find sharkd binary in bundled or system locations.".to_string(),
                path: None,
            });
            return InstallHealthStatus {
                ok: false,
                issues,
                checked_paths,
                recommended_action: format!("repair ({})", e.lines().next().unwrap_or("unknown")),
            };
        }
    };

    if cfg!(target_os = "windows") && is_production {
        if let Some(dir) = &exe_dir {
            let bundled_primary = dir.join(format!("sharkd-{}.exe", get_target_triple()));
            issues.extend(validate_windows_runtime(dir, &bundled_primary));

            if sharkd_path != bundled_primary {
                issues.push(InstallIssue {
                    code: "invalid_bundle".to_string(),
                    message: "Bundled sharkd is missing or invalid; PacketPilot is currently relying on a system sharkd fallback.".to_string(),
                    path: Some(sharkd_path.display().to_string()),
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    if issues.is_empty() {
        match Command::new(&sharkd_path)
            .arg("-v")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => {}
            Ok(status) => issues.push(InstallIssue {
                code: "spawn_failed".to_string(),
                message: format!("sharkd check returned non-zero status: {}", status),
                path: Some(sharkd_path.display().to_string()),
            }),
            Err(e) => {
                // Surface likely missing dependency names from Windows loader errors.
                let error_msg = e.to_string();
                let mut message =
                    "sharkd failed to start; installation may be incomplete.".to_string();
                if error_msg.to_ascii_lowercase().contains(".dll") {
                    message = format!("sharkd failed to start: {}", error_msg);
                }
                issues.push(InstallIssue {
                    code: "spawn_failed".to_string(),
                    message,
                    path: Some(sharkd_path.display().to_string()),
                });
            }
        }
    }

    InstallHealthStatus {
        ok: issues.is_empty(),
        issues,
        checked_paths,
        recommended_action: if cfg!(target_os = "windows") {
            "repair".to_string()
        } else {
            "none".to_string()
        },
    }
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
                    Please run installation repair or reinstall PacketPilot. \n\
                    If running from source, ensure Wireshark is installed and sharkd is in PATH.",
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

    /// Search frames with a display filter - passes filter to frames request
    pub fn search_frames(
        &self,
        filter: &str,
        skip: u32,
        limit: u32,
    ) -> Result<(Vec<Frame>, u64), String> {
        // Build the frames request with filter
        // Note: sharkd requires skip > 0 if present, so omit when 0
        let params = if skip > 0 {
            json!({
                "filter": filter,
                "skip": skip,
                "limit": limit
            })
        } else {
            json!({
                "filter": filter,
                "limit": limit
            })
        };

        let result = self.send_request("frames", Some(params))?;

        // sharkd returns frames as an array directly, or as {"frames": [...]}
        let frames: Vec<Frame> = if result.is_array() {
            serde_json::from_value(result.clone())
                .map_err(|e| format!("Failed to parse frames: {}", e))?
        } else if let Some(frames_arr) = result.get("frames") {
            serde_json::from_value(frames_arr.clone())
                .map_err(|e| format!("Failed to parse frames: {}", e))?
        } else {
            vec![]
        };

        // For filtered searches, we don't have an easy way to get total matching count
        // without doing a separate query. Use the returned count as an estimate.
        let total = frames.len() as u64;

        Ok((frames, total))
    }

    /// Follow a TCP, UDP, or HTTP stream
    pub fn follow_stream(&self, protocol: &str, stream_id: u32) -> Result<StreamData, String> {
        // Build the filter for the stream (e.g., "tcp.stream==0")
        let filter = format!("{}.stream=={}", protocol.to_lowercase(), stream_id);

        let result = self.send_request(
            "follow",
            Some(json!({
                "follow": protocol.to_uppercase(),
                "filter": filter
            })),
        )?;

        serde_json::from_value(result).map_err(|e| format!("Failed to parse stream data: {}", e))
    }

    /// Get capture statistics (protocol hierarchy, conversations, endpoints)
    /// Uses a single batched tap request for performance
    pub fn capture_stats(&self) -> Result<CaptureStats, String> {
        // Batch all tap requests into a single sharkd call
        // Format: {"tap0": "phs", "tap1": "conv:TCP", ...}
        // Note: endpoint tap uses "endpt:" (not "endp:")
        let result = self.send_request("tap", Some(json!({
            "tap0": "phs",
            "tap1": "conv:TCP",
            "tap2": "conv:UDP",
            "tap3": "endpt:IPv4"
        })))?;

        // Extract results from the batched response
        // Response format: {"taps": [{"tap": "phs", "protos": [...]}, {"tap": "conv:TCP", "convs": [...]}, ...]}
        // Note: taps may be returned in any order, so we find them by the "tap" field
        let taps = match result.get("taps").and_then(|t| t.as_array()) {
            Some(t) => t,
            None => return Ok(CaptureStats::default()),
        };

        // Helper closure to find a tap by its name
        let find_tap = |name: &str| -> Option<&Value> {
            taps.iter().find(|tap| {
                tap.get("tap").and_then(|t| t.as_str()) == Some(name)
            })
        };

        // Extract protocol hierarchy from phs tap (uses "protos" field)
        let protocol_hierarchy = find_tap("phs")
            .and_then(|tap| tap.get("protos"))
            .and_then(|protos| serde_json::from_value(protos.clone()).ok())
            .unwrap_or_default();

        // Extract TCP conversations
        let tcp_conversations = find_tap("conv:TCP")
            .and_then(|tap| tap.get("convs"))
            .and_then(|convs| serde_json::from_value(convs.clone()).ok())
            .unwrap_or_default();

        // Extract UDP conversations
        let udp_conversations = find_tap("conv:UDP")
            .and_then(|tap| tap.get("convs"))
            .and_then(|convs| serde_json::from_value(convs.clone()).ok())
            .unwrap_or_default();

        // Extract endpoints (uses "hosts" field)
        let endpoints = find_tap("endpt:IPv4")
            .and_then(|tap| tap.get("hosts"))
            .and_then(|hosts| serde_json::from_value(hosts.clone()).ok())
            .unwrap_or_default();

        Ok(CaptureStats {
            protocol_hierarchy,
            tcp_conversations,
            udp_conversations,
            endpoints,
        })
    }

    /// Extract protocol hierarchy from tap result
    fn extract_protocol_hierarchy(result: &Value) -> Vec<ProtocolNode> {
        result
            .get("taps")
            .and_then(|taps| taps.as_array())
            .and_then(|arr| arr.first())
            .and_then(|tap| tap.get("proto"))
            .and_then(|proto| serde_json::from_value(proto.clone()).ok())
            .unwrap_or_default()
    }

    /// Extract conversations from tap result
    fn extract_conversations(result: &Value) -> Vec<Conversation> {
        result
            .get("taps")
            .and_then(|taps| taps.as_array())
            .and_then(|arr| arr.first())
            .and_then(|tap| tap.get("convs"))
            .and_then(|convs| serde_json::from_value(convs.clone()).ok())
            .unwrap_or_default()
    }

    /// Extract endpoints from tap result
    fn extract_endpoints(result: &Value) -> Vec<Endpoint> {
        result
            .get("taps")
            .and_then(|taps| taps.as_array())
            .and_then(|arr| arr.first())
            .and_then(|tap| tap.get("hosts"))
            .and_then(|hosts| serde_json::from_value(hosts.clone()).ok())
            .unwrap_or_default()
    }
}
