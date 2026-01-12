//! HTTP bridge for Python sidecar to access sharkd data.
//!
//! This module provides a local HTTP server that Python can call
//! to fetch packet data from the Rust-managed sharkd process.

use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

use crate::{get_sharkd, FrameData, FramesResult};

/// Request to fetch frames
#[derive(Debug, Deserialize)]
pub struct FramesRequest {
    pub skip: u32,
    pub limit: u32,
}

/// Request to fetch frame details
#[derive(Debug, Deserialize)]
pub struct FrameDetailsRequest {
    pub frame_num: u32,
}

/// Request to check a filter
#[derive(Debug, Deserialize)]
pub struct CheckFilterRequest {
    pub filter: String,
}

/// Response for filter check
#[derive(Debug, Serialize)]
pub struct CheckFilterResponse {
    pub valid: bool,
}

/// Request to search packets with a filter
#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub filter: String,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub skip: u32,
}

fn default_limit() -> u32 {
    100
}

/// Response for packet search
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub frames: Vec<FrameData>,
    pub total_matching: u64,
    pub filter_applied: String,
}

/// Request to follow a stream
#[derive(Debug, Deserialize)]
pub struct StreamRequest {
    pub stream_id: u32,
    #[serde(default = "default_protocol")]
    pub protocol: String,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_protocol() -> String {
    "TCP".to_string()
}

fn default_format() -> String {
    "ascii".to_string()
}

/// Endpoint info for stream response
#[derive(Debug, Serialize)]
pub struct EndpointInfo {
    pub host: String,
    pub port: String,
}

/// Stream segment with decoded data
#[derive(Debug, Serialize)]
pub struct StreamSegment {
    pub direction: String,
    pub size: u64,
    pub data: String,
}

/// Response for stream follow
#[derive(Debug, Serialize)]
pub struct StreamResponse {
    pub server: EndpointInfo,
    pub client: EndpointInfo,
    pub server_bytes: u64,
    pub client_bytes: u64,
    pub segments: Vec<StreamSegment>,
    pub combined_text: Option<String>,
}

/// Summary stats for capture
#[derive(Debug, Serialize)]
pub struct StatsSummary {
    pub total_frames: u64,
    pub duration: Option<f64>,
    pub protocol_count: usize,
    pub tcp_conversation_count: usize,
    pub udp_conversation_count: usize,
    pub endpoint_count: usize,
}

/// Protocol node for response (re-exported from sharkd_client)
#[derive(Debug, Serialize)]
pub struct ProtocolNodeResponse {
    pub protocol: String,
    pub frames: u64,
    pub bytes: u64,
    pub children: Vec<ProtocolNodeResponse>,
}

/// Conversation for response
#[derive(Debug, Serialize)]
pub struct ConversationResponse {
    pub src_addr: String,
    pub dst_addr: String,
    pub src_port: Option<String>,
    pub dst_port: Option<String>,
    pub rx_frames: u64,
    pub rx_bytes: u64,
    pub tx_frames: u64,
    pub tx_bytes: u64,
    pub filter: Option<String>,
}

/// Endpoint for response
#[derive(Debug, Serialize)]
pub struct EndpointResponse {
    pub host: String,
    pub port: Option<String>,
    pub rx_frames: u64,
    pub rx_bytes: u64,
    pub tx_frames: u64,
    pub tx_bytes: u64,
}

/// Response for capture statistics
#[derive(Debug, Serialize)]
pub struct CaptureStatsResponse {
    pub summary: StatsSummary,
    pub protocol_hierarchy: Vec<ProtocolNodeResponse>,
    pub tcp_conversations: Vec<ConversationResponse>,
    pub udp_conversations: Vec<ConversationResponse>,
    pub endpoints: Vec<EndpointResponse>,
}

/// Handler for GET /health
async fn health_handler() -> &'static str {
    "ok"
}

/// Handler for POST /frames
async fn get_frames_handler(Json(req): Json<FramesRequest>) -> Json<FramesResult> {
    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        if let Ok(frames) = client.frames(req.skip, req.limit) {
            if let Ok(status) = client.status() {
                return Json(FramesResult {
                    frames: frames.into_iter().map(FrameData::from).collect(),
                    total: status.frames.unwrap_or(0),
                });
            }
        }
    }
    Json(FramesResult {
        frames: vec![],
        total: 0,
    })
}

/// Handler for POST /frame-details
async fn get_frame_details_handler(
    Json(req): Json<FrameDetailsRequest>,
) -> Json<serde_json::Value> {
    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        if let Ok(details) = client.frame(req.frame_num) {
            return Json(details);
        }
    }
    Json(serde_json::json!({"error": "Failed to get frame details"}))
}

/// Handler for POST /check-filter
async fn check_filter_handler(Json(req): Json<CheckFilterRequest>) -> Json<CheckFilterResponse> {
    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        if let Ok(valid) = client.check_filter(&req.filter) {
            return Json(CheckFilterResponse { valid });
        }
    }
    Json(CheckFilterResponse { valid: false })
}

/// Handler for POST /search - search packets with a display filter
async fn search_handler(Json(req): Json<SearchRequest>) -> Json<SearchResult> {
    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        // First validate the filter
        if let Ok(valid) = client.check_filter(&req.filter) {
            if !valid {
                return Json(SearchResult {
                    frames: vec![],
                    total_matching: 0,
                    filter_applied: req.filter,
                });
            }
        }

        // Execute the search
        if let Ok((frames, total)) = client.search_frames(&req.filter, req.skip, req.limit) {
            return Json(SearchResult {
                frames: frames.into_iter().map(FrameData::from).collect(),
                total_matching: total,
                filter_applied: req.filter,
            });
        }
    }
    Json(SearchResult {
        frames: vec![],
        total_matching: 0,
        filter_applied: req.filter,
    })
}

/// Handler for POST /stream - follow a TCP/UDP stream
async fn stream_handler(Json(req): Json<StreamRequest>) -> Json<StreamResponse> {
    let empty_response = StreamResponse {
        server: EndpointInfo {
            host: String::new(),
            port: String::new(),
        },
        client: EndpointInfo {
            host: String::new(),
            port: String::new(),
        },
        server_bytes: 0,
        client_bytes: 0,
        segments: vec![],
        combined_text: None,
    };

    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        if let Ok(stream) = client.follow_stream(&req.protocol, req.stream_id) {
            // Decode and format the payload segments
            let segments: Vec<StreamSegment> = stream
                .payloads
                .iter()
                .map(|p| {
                    let direction = if p.s == 0 {
                        "client_to_server"
                    } else {
                        "server_to_client"
                    };

                    let data = match req.format.as_str() {
                        "hex" => {
                            // Decode base64 and convert to hex
                            BASE64
                                .decode(&p.d)
                                .map(|bytes| {
                                    bytes
                                        .iter()
                                        .map(|b| format!("{:02x}", b))
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                })
                                .unwrap_or_else(|_| p.d.clone())
                        }
                        "raw" => p.d.clone(), // Keep base64 for raw
                        _ => {
                            // ascii (default) - decode base64 to string
                            BASE64
                                .decode(&p.d)
                                .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
                                .unwrap_or_else(|_| "[binary data]".to_string())
                        }
                    };

                    StreamSegment {
                        direction: direction.to_string(),
                        size: p.n,
                        data,
                    }
                })
                .collect();

            // Build combined text for ASCII format
            let combined_text = if req.format == "ascii" || req.format.is_empty() {
                Some(
                    segments
                        .iter()
                        .map(|s| format!("[{}]\n{}", s.direction, s.data))
                        .collect::<Vec<_>>()
                        .join("\n\n"),
                )
            } else {
                None
            };

            return Json(StreamResponse {
                server: EndpointInfo {
                    host: stream.shost,
                    port: stream.sport,
                },
                client: EndpointInfo {
                    host: stream.chost,
                    port: stream.cport,
                },
                server_bytes: stream.sbytes,
                client_bytes: stream.cbytes,
                segments,
                combined_text,
            });
        }
    }
    Json(empty_response)
}

/// Handler for GET /capture-stats - get capture statistics
async fn capture_stats_handler() -> Json<CaptureStatsResponse> {
    let empty_response = CaptureStatsResponse {
        summary: StatsSummary {
            total_frames: 0,
            duration: None,
            protocol_count: 0,
            tcp_conversation_count: 0,
            udp_conversation_count: 0,
            endpoint_count: 0,
        },
        protocol_hierarchy: vec![],
        tcp_conversations: vec![],
        udp_conversations: vec![],
        endpoints: vec![],
    };

    let client_guard = get_sharkd().lock();
    if let Some(client) = client_guard.as_ref() {
        // Get basic status for frame count and duration
        let status = client.status().ok();

        // Get capture statistics (single batched sharkd request - 4 taps in 1 call)
        if let Ok(stats) = client.capture_stats() {
            let protocol_hierarchy = convert_protocol_nodes(&stats.protocol_hierarchy);
            let protocol_count = count_protocols(&stats.protocol_hierarchy);

            return Json(CaptureStatsResponse {
                summary: StatsSummary {
                    total_frames: status.as_ref().and_then(|s| s.frames).unwrap_or(0),
                    duration: status.as_ref().and_then(|s| s.duration),
                    protocol_count,
                    tcp_conversation_count: stats.tcp_conversations.len(),
                    udp_conversation_count: stats.udp_conversations.len(),
                    endpoint_count: stats.endpoints.len(),
                },
                protocol_hierarchy,
                tcp_conversations: stats
                    .tcp_conversations
                    .into_iter()
                    .map(|c| ConversationResponse {
                        src_addr: c.saddr,
                        dst_addr: c.daddr,
                        src_port: c.sport,
                        dst_port: c.dport,
                        rx_frames: c.rxf,
                        rx_bytes: c.rxb,
                        tx_frames: c.txf,
                        tx_bytes: c.txb,
                        filter: c.filter,
                    })
                    .collect(),
                udp_conversations: stats
                    .udp_conversations
                    .into_iter()
                    .map(|c| ConversationResponse {
                        src_addr: c.saddr,
                        dst_addr: c.daddr,
                        src_port: c.sport,
                        dst_port: c.dport,
                        rx_frames: c.rxf,
                        rx_bytes: c.rxb,
                        tx_frames: c.txf,
                        tx_bytes: c.txb,
                        filter: c.filter,
                    })
                    .collect(),
                endpoints: stats
                    .endpoints
                    .into_iter()
                    .map(|e| EndpointResponse {
                        host: e.host,
                        port: e.port,
                        rx_frames: e.rxf,
                        rx_bytes: e.rxb,
                        tx_frames: e.txf,
                        tx_bytes: e.txb,
                    })
                    .collect(),
            });
        }
    }
    Json(empty_response)
}

/// Convert protocol nodes from sharkd format to response format
fn convert_protocol_nodes(
    nodes: &[crate::sharkd_client::ProtocolNode],
) -> Vec<ProtocolNodeResponse> {
    nodes
        .iter()
        .map(|n| ProtocolNodeResponse {
            protocol: n.protocol.clone(),
            frames: n.frames,
            bytes: n.bytes,
            children: convert_protocol_nodes(&n.children),
        })
        .collect()
}

/// Count total protocols in hierarchy
fn count_protocols(nodes: &[crate::sharkd_client::ProtocolNode]) -> usize {
    nodes
        .iter()
        .map(|n| 1 + count_protocols(&n.children))
        .sum()
}

/// Start the HTTP bridge server on port 8766
pub async fn start_http_bridge() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/frames", post(get_frames_handler))
        .route("/frame-details", post(get_frame_details_handler))
        .route("/check-filter", post(check_filter_handler))
        .route("/search", post(search_handler))
        .route("/stream", post(stream_handler))
        .route("/capture-stats", get(capture_stats_handler))
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8766));
    println!("Rust HTTP bridge listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
