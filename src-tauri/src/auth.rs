use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::io::Read;
use std::net::TcpListener;

const AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CALLBACK_PORT: u16 = 1455;
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const SCOPES: &str = "openid profile email offline_access";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub account_id: Option<String>,
}


fn generate_pkce() -> (String, String) {
    let mut verifier_bytes = [0u8; 32];
    getrandom::getrandom(&mut verifier_bytes).expect("failed to generate random bytes");
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let challenge_hash = sha256_digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(challenge_hash);

    (verifier, challenge)
}

fn sha256_digest(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}


fn extract_account_id_from_jwt(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;

    claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("user_id"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| claims.get("sub").and_then(|v| v.as_str()).map(String::from))
}

pub fn build_auth_url() -> (String, String) {
    let (verifier, challenge) = generate_pkce();

    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&prompt=login&codex_cli_simplified_flow=true&originator=packetpilot",
        AUTH_URL,
        urlencoding_encode(CLIENT_ID),
        urlencoding_encode(REDIRECT_URI),
        urlencoding_encode(SCOPES),
        urlencoding_encode(&challenge),
    );

    (url, verifier)
}

fn urlencoding_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                String::from(b as char)
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

pub fn wait_for_callback() -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", CALLBACK_PORT)).map_err(|e| {
        format!(
            "Failed to bind callback listener on port {}: {}",
            CALLBACK_PORT, e
        )
    })?;

    // 2-minute timeout so we never freeze the app permanently
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking mode: {}", e))?;
    // set_read_timeout doesn't apply to accept(), use SO_RCVTIMEO workaround
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let fd = listener.as_raw_fd();
        let tv = libc::timeval { tv_sec: 120, tv_usec: 0 };
        unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_RCVTIMEO,
                &tv as *const libc::timeval as *const libc::c_void,
                std::mem::size_of::<libc::timeval>() as libc::socklen_t,
            );
        }
    }

    let (mut stream, _addr) = listener
        .accept()
        .map_err(|e| format!("Sign-in timed out or failed: {}", e))?;

    let mut buffer = [0u8; 4096];
    let n = stream
        .read(&mut buffer)
        .map_err(|e| format!("Failed to read callback request: {}", e))?;

    let request = String::from_utf8_lossy(&buffer[..n]);

    // Send response HTML
    let response_body = r#"<html><body><h2>Sign-in successful!</h2><p>You can close this tab and return to PacketPilot.</p><script>window.close()</script></body></html>"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_body.len(),
        response_body
    );
    use std::io::Write;
    let _ = stream.write_all(response.as_bytes());

    // Extract authorization code from query string
    let first_line = request.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("");

    if let Some(query) = path.split('?').nth(1) {
        for param in query.split('&') {
            if let Some(code) = param.strip_prefix("code=") {
                return Ok(code.to_string());
            }
        }
    }

    Err("No authorization code found in callback".to_string())
}

pub fn exchange_code(code: &str, verifier: &str) -> Result<AuthTokens, String> {
    let body = format!(
        "grant_type=authorization_code&client_id={}&code={}&redirect_uri={}&code_verifier={}",
        urlencoding_encode(CLIENT_ID),
        urlencoding_encode(code),
        urlencoding_encode(REDIRECT_URI),
        urlencoding_encode(verifier),
    );

    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "-X",
            "POST",
            TOKEN_URL,
            "-H",
            "Content-Type: application/x-www-form-urlencoded",
            "-d",
            &body,
        ])
        .output()
        .map_err(|e| format!("Failed to exchange code: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Token exchange failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let response_text = String::from_utf8_lossy(&output.stdout);
    let response: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if let Some(error) = response.get("error").and_then(|v| v.as_str()) {
        let desc = response
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("OAuth error: {} - {}", error, desc));
    }

    let access_token = response
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("No access_token in response")?
        .to_string();

    let refresh_token = response
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(String::from);

    let expires_in = response.get("expires_in").and_then(|v| v.as_u64());

    let account_id = extract_account_id_from_jwt(&access_token);

    Ok(AuthTokens {
        access_token,
        refresh_token,
        expires_in,
        account_id,
    })
}
