//! HTTP bridge for Python sidecar to access sharkd data.
//!
//! This module provides a local HTTP server that Python can call
//! to fetch packet data from the Rust-managed sharkd process.

use axum::{
    extract::Json,
    routing::{get, post},
    Router,
};
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
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8766));
    println!("Rust HTTP bridge listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
