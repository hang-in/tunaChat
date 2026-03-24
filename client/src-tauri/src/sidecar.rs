//! Python sidecar process management with Tauri event integration.
//!
//! Architecture:
//!   1. `start_sidecar` spawns `python -m sidecar` as a child process
//!   2. A background thread reads stdout JSON Lines and emits Tauri events
//!   3. `chat_send` writes a request to sidecar stdin
//!   4. Frontend listens to Tauri events for streaming updates

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Incremental request ID generator.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Sidecar request (Rust -> Python).
#[derive(Debug, Serialize)]
struct SidecarRequest {
    id: u64,
    method: String,
    params: serde_json::Value,
}

/// Sidecar event (Python -> Rust), emitted to frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarEvent {
    pub id: Option<u64>,
    pub event: Option<String>,
    pub data: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Manages the Python sidecar child process.
pub struct SidecarManager {
    child: Option<Child>,
    stdin_writer: Option<std::process::ChildStdin>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin_writer: None,
        }
    }

    /// Spawn the Python sidecar process and start the stdout reader thread.
    ///
    /// `sidecar_dir` is the path to the `sidecar/` package directory.
    /// We run `python -m sidecar` from its **parent** so Python finds the package.
    pub fn start(&mut self, sidecar_dir: &str, app: AppHandle) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }

        let sidecar_path = std::path::Path::new(sidecar_dir);
        let project_root = sidecar_path
            .parent()
            .ok_or("cannot resolve sidecar parent directory")?;

        let mut child = Command::new("python")
            .args(["-m", "sidecar"])
            .current_dir(project_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

        // Take ownership of stdin for writing requests
        let stdin = child.stdin.take().ok_or("failed to capture sidecar stdin")?;
        self.stdin_writer = Some(stdin);

        // Spawn stdout reader thread -> Tauri events
        let stdout = child.stdout.take().ok_or("failed to capture sidecar stdout")?;
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) if !text.is_empty() => {
                        if let Ok(event) = serde_json::from_str::<SidecarEvent>(&text) {
                            let _ = app_handle.emit("sidecar:event", &event);
                        }
                    }
                    Err(_) => break,
                    _ => {}
                }
            }
        });

        // Spawn stderr reader thread -> log
        let stderr = child.stderr.take().ok_or("failed to capture sidecar stderr")?;
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) if !text.is_empty() => {
                        eprintln!("[sidecar] {text}");
                    }
                    Err(_) => break,
                    _ => {}
                }
            }
        });

        self.child = Some(child);
        Ok(())
    }

    /// Send a JSON Lines request to the sidecar stdin.
    pub fn send(&mut self, method: &str, params: serde_json::Value) -> Result<u64, String> {
        let stdin = self.stdin_writer.as_mut().ok_or("sidecar not running")?;

        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let req = SidecarRequest {
            id,
            method: method.to_string(),
            params,
        };

        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        writeln!(stdin, "{}", line).map_err(|e| format!("write to sidecar: {e}"))?;
        stdin.flush().map_err(|e| format!("flush sidecar stdin: {e}"))?;

        Ok(id)
    }

    /// Stop the sidecar process.
    pub fn stop(&mut self) {
        // Drop stdin first to signal EOF
        self.stdin_writer.take();
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Thread-safe global sidecar state.
pub type SidecarState = Mutex<SidecarManager>;
