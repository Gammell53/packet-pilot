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

/// Find the sharkd binary - tries bundled first (production), then system PATH (dev)
fn find_sharkd() -> Result<PathBuf, String> {
    let mut debug_info = Vec::new();
    debug_info.push("=== Sharkd Detection Debug ===".to_string());

    // In production, try bundled sharkd first
    match std::env::current_exe() {
        Ok(exe_path) => {
            debug_info.push(format!("Current executable: {:?}", exe_path));
            let path_str = exe_path.to_string_lossy();
            let is_production =
                !path_str.contains("target/debug") && !path_str.contains("target/release");
            debug_info.push(format!("Is production mode: {}", is_production));

            if is_production {
                if let Some(exe_dir) = exe_path.parent() {
                    debug_info.push(format!("Executable directory: {:?}", exe_dir));
                    let target_triple = get_target_triple();
                    debug_info.push(format!("Target triple: {}", target_triple));

                    // List all files in exe_dir for debugging
                    if let Ok(entries) = std::fs::read_dir(exe_dir) {
                        let files: Vec<String> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.file_name().to_string_lossy().to_string())
                            .collect();
                        debug_info.push(format!("Files in exe_dir ({} total): {:?}", files.len(), files.iter().take(20).collect::<Vec<_>>()));
                        if files.len() > 20 {
                            debug_info.push(format!("  ... and {} more files", files.len() - 20));
                        }
                    } else {
                        debug_info.push("Failed to list files in exe_dir".to_string());
                    }

                    // Try the wrapper script first (sets up LD_LIBRARY_PATH)
                    #[cfg(not(target_os = "windows"))]
                    {
                        let wrapper_name = format!("sharkd-wrapper-{}", target_triple);
                        let wrapper_path = exe_dir.join(&wrapper_name);
                        debug_info.push(format!("Checking wrapper: {:?} (exists: {})", wrapper_path, wrapper_path.exists()));
                        if wrapper_path.exists() {
                            println!("{}", debug_info.join("\n"));
                            println!("Using bundled sharkd wrapper at: {:?}", wrapper_path);
                            return Ok(wrapper_path);
                        }
                    }

                    // Try direct binary
                    #[cfg(target_os = "windows")]
                    let sidecar_name = format!("sharkd-{}.exe", target_triple);
                    #[cfg(not(target_os = "windows"))]
                    let sidecar_name = format!("sharkd-{}", target_triple);

                    let sidecar_path = exe_dir.join(&sidecar_name);
                    debug_info.push(format!("Checking sidecar: {:?} (exists: {})", sidecar_path, sidecar_path.exists()));
                    if sidecar_path.exists() {
                        println!("{}", debug_info.join("\n"));
                        println!("Found bundled sharkd at: {:?}", sidecar_path);
                        return Ok(sidecar_path);
                    }
                } else {
                    debug_info.push("Failed to get parent directory of executable".to_string());
                }
            } else {
                debug_info.push("Development mode - skipping bundled sharkd check".to_string());
            }
        }
        Err(e) => {
            debug_info.push(format!("Failed to get current executable: {}", e));
        }
    }

    // Fall back to system sharkd (development mode or if bundled not found)
    debug_info.push("Falling back to system sharkd...".to_string());

    #[cfg(target_os = "windows")]
    {
        // On Windows, check standard Wireshark installation paths
        let windows_paths = [
            r"C:\Program Files\Wireshark\sharkd.exe",
            r"C:\Program Files (x86)\Wireshark\sharkd.exe",
        ];
        for path in &windows_paths {
            let path_buf = PathBuf::from(path);
            let exists = path_buf.exists();
            debug_info.push(format!("Checking system path: {} (exists: {})", path, exists));
            if exists {
                println!("{}", debug_info.join("\n"));
                println!("Found system sharkd at: {}", path);
                return Ok(path_buf);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = std::process::Command::new("which").arg("sharkd").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    println!("{}", debug_info.join("\n"));
                    println!("Using system sharkd: {}", path);
                    return Ok(PathBuf::from(path));
                }
            }
        }
        debug_info.push("'which sharkd' did not find sharkd in PATH".to_string());
    }

    // Print all debug info before returning error
    let debug_output = debug_info.join("\n");
    eprintln!("{}", debug_output);

    Err(format!(
        "Sharkd not found. Please install Wireshark.\n\nDebug info:\n{}",
        debug_output
    ))
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
