use tauri::Manager;

mod sidecar;

use sidecar::{SidecarManager, SidecarState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

/// Scan a workspace root for projects (1-level deep).
/// Classification:
///   - .git present → "project"
///   - no .git but agent session exists → "chat"
/// Also counts CLI agent sessions from ~/.claude/projects/
#[tauri::command]
fn scan_workspace(root: String) -> Result<Vec<serde_json::Value>, String> {
    let root_path = std::path::Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let agent_session_dirs = [".claude", ".gemini", ".codex-cli", ".opencode"];
    let mut results = Vec::new();

    // Resolve ~/.claude/projects/ for session counting
    let home = dirs::home_dir().unwrap_or_default();
    let claude_projects_dir = home.join(".claude").join("projects");

    let entries = std::fs::read_dir(root_path)
        .map_err(|e| format!("read_dir: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let has_git = path.join(".git").exists();
        let has_local_session = agent_session_dirs
            .iter()
            .any(|d| path.join(d).exists());

        // Count Claude Code sessions from ~/.claude/projects/<encoded-path>/
        let abs_path = path.canonicalize().unwrap_or_else(|_| path.clone());
        let abs_str = abs_path.to_string_lossy().to_string();
        // Windows canonicalize adds \\?\ prefix — strip it
        let clean_path = if abs_str.starts_with("\\\\?\\") {
            &abs_str[4..]
        } else {
            &abs_str
        };
        let encoded_path = clean_path
            .replace('\\', "-")
            .replace('/', "-")
            .replace(':', "-");
        let claude_session_dir = claude_projects_dir.join(&encoded_path);
        let session_count = if claude_session_dir.is_dir() {
            std::fs::read_dir(&claude_session_dir)
                .map(|entries| {
                    entries
                        .flatten()
                        .filter(|e| {
                            e.path().extension().map_or(false, |ext| ext == "jsonl")
                        })
                        .count()
                })
                .unwrap_or(0)
        } else {
            0
        };

        let has_any_session = has_local_session || session_count > 0;

        let project_type = match (has_git, has_any_session) {
            (true, _) => "project",
            (false, true) => "chat",
            (false, false) => continue,
        };

        // Detect default engine
        let default_engine = if path.join(".claude").exists() || session_count > 0 {
            "claude"
        } else if path.join(".gemini").exists() {
            "gemini"
        } else if path.join(".codex-cli").exists() {
            "codex"
        } else if path.join(".opencode").exists() {
            "opencode"
        } else {
            "claude"
        };

        // Which engines have sessions
        let mut engines: Vec<&str> = Vec::new();
        if path.join(".claude").exists() || session_count > 0 { engines.push("claude"); }
        if path.join(".gemini").exists() { engines.push("gemini"); }
        if path.join(".codex-cli").exists() { engines.push("codex"); }
        if path.join(".opencode").exists() { engines.push("opencode"); }

        // Git current branch
        let git_branch = if has_git {
            std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(&path)
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                    } else {
                        None
                    }
                })
        } else {
            None
        };

        results.push(serde_json::json!({
            "key": name.to_lowercase().replace(' ', "-"),
            "name": name,
            "path": path.to_string_lossy(),
            "type": project_type,
            "defaultEngine": default_engine,
            "gitBranch": git_branch,
            "sessionCount": session_count,
            "engines": engines,
        }));
    }

    Ok(results)
}

/// Get project context: git status, file stats, agent session info.
#[tauri::command]
fn get_project_context(project_path: String) -> Result<serde_json::Value, String> {
    let path = std::path::Path::new(&project_path);
    if !path.is_dir() {
        return Err(format!("not a directory: {project_path}"));
    }

    // Git current branch
    let git_branch = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    // Git status (changed file count)
    let git_dirty_count = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .count()
        })
        .unwrap_or(0);

    // Detect agent sessions
    let has_claude = path.join(".claude").exists();
    let has_gemini = path.join(".gemini").exists();
    let has_codex = path.join(".codex-cli").exists();
    let has_opencode = path.join(".opencode").exists();

    // Read README.md or CLAUDE.md for markdown field
    let markdown = ["CLAUDE.md", "README.md"]
        .iter()
        .find_map(|f| std::fs::read_to_string(path.join(f)).ok())
        .unwrap_or_default();

    // File count (rough, top-level)
    let file_count = std::fs::read_dir(path)
        .map(|entries| entries.count())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "gitBranch": git_branch,
        "gitDirtyCount": git_dirty_count,
        "hasClaudeSession": has_claude,
        "hasGeminiSession": has_gemini,
        "hasCodexSession": has_codex,
        "hasOpenCodeSession": has_opencode,
        "markdown": if markdown.len() > 2000 { &markdown[..2000] } else { &markdown },
        "fileCount": file_count,
    }))
}

/// Start the Python sidecar process.
#[tauri::command]
fn start_sidecar(app: tauri::AppHandle, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;

    // In dev: cwd is client/src-tauri → project root is ../../
    // In prod: sidecar is bundled alongside the executable
    let candidates = [
        // dev mode: client/src-tauri/../../sidecar
        std::env::current_dir().unwrap_or_default().join("../../sidecar"),
        // tauri dev from client/: ../sidecar
        std::env::current_dir().unwrap_or_default().join("../sidecar"),
        // prod: next to executable
        std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("sidecar"),
    ];

    let sidecar_dir = candidates
        .iter()
        .find(|p| p.join("__main__.py").exists())
        .ok_or_else(|| {
            format!(
                "sidecar directory not found. Searched: {:?}",
                candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
            )
        })?;

    let dir_str = sidecar_dir.to_string_lossy().to_string();
    mgr.start(&dir_str, app.clone())
}

/// Send a chat message via the sidecar.
#[tauri::command]
fn chat_send(
    state: tauri::State<'_, SidecarState>,
    engine: Option<String>,
    model: Option<String>,
    prompt: String,
    resume_token: Option<String>,
    project_path: Option<String>,
    system_prompt: Option<String>,
    allowed_tools: Option<Vec<String>>,
) -> Result<u64, String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;

    let mut params = serde_json::json!({
        "engine": engine.unwrap_or_else(|| "claude".to_string()),
        "prompt": prompt,
    });

    if let Some(m) = model {
        params["model"] = serde_json::Value::String(m);
    }
    if let Some(rt) = resume_token {
        params["resume_token"] = serde_json::Value::String(rt);
    }
    if let Some(pp) = project_path {
        params["cwd"] = serde_json::Value::String(pp);
    }
    if let Some(sp) = system_prompt {
        params["system_prompt"] = serde_json::Value::String(sp);
    }
    if let Some(tools) = allowed_tools {
        params["allowed_tools"] = serde_json::json!(tools);
    }

    mgr.send("chat", params)
}

/// Cancel an active chat request.
#[tauri::command]
fn chat_cancel(state: tauri::State<'_, SidecarState>, request_id: u64) -> Result<(), String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;
    mgr.send("cancel", serde_json::json!({ "id": request_id }))?;
    Ok(())
}

/// List available models for an engine.
#[tauri::command]
fn list_models(state: tauri::State<'_, SidecarState>, engine: Option<String>) -> Result<u64, String> {
    let mut mgr = state.lock().map_err(|e| e.to_string())?;
    mgr.send("models", serde_json::json!({ "engine": engine.unwrap_or_else(|| "claude".to_string()) }))
}

/// Run rawq code search.
#[tauri::command]
fn code_search(
    app: tauri::AppHandle,
    query: String,
    project_path: String,
    lang: Option<String>,
) -> Result<String, String> {
    let rawq_path = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| {
            let p = d.join("binaries/rawq-x86_64-pc-windows-msvc.exe");
            if p.exists() { Some(p) } else { None }
        })
        .or_else(|| {
            // Dev mode fallback
            std::env::current_dir().ok().map(|cwd| {
                cwd.join("binaries/rawq-x86_64-pc-windows-msvc.exe")
            }).filter(|p| p.exists())
        })
        .ok_or("rawq binary not found")?;

    let mut cmd = std::process::Command::new(&rawq_path);
    cmd.arg("search").arg(&query).arg("--project").arg(&project_path);
    if let Some(l) = lang {
        cmd.arg("--lang").arg(l);
    }

    let output = cmd.output().map_err(|e| format!("rawq: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("rawq failed: {stderr}"))
    }
}

/// Run rawq code map.
#[tauri::command]
fn code_map(
    app: tauri::AppHandle,
    project_path: String,
    depth: Option<u32>,
    lang: Option<String>,
) -> Result<String, String> {
    let rawq_path = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|d| {
            let p = d.join("binaries/rawq-x86_64-pc-windows-msvc.exe");
            if p.exists() { Some(p) } else { None }
        })
        .or_else(|| {
            std::env::current_dir().ok().map(|cwd| {
                cwd.join("binaries/rawq-x86_64-pc-windows-msvc.exe")
            }).filter(|p| p.exists())
        })
        .ok_or("rawq binary not found")?;

    let mut cmd = std::process::Command::new(&rawq_path);
    cmd.arg("map").arg("--project").arg(&project_path);
    cmd.arg("--depth").arg(depth.unwrap_or(2).to_string());
    if let Some(l) = lang {
        cmd.arg("--lang").arg(l);
    }

    let output = cmd.output().map_err(|e| format!("rawq: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("rawq failed: {stderr}"))
    }
}

#[cfg(desktop)]
#[tauri::command]
fn open_branch_window(
    app: tauri::AppHandle,
    branch_id: String,
    conv_id: String,
    label: String,
    project_key: String,
) -> Result<(), String> {
    let short_id = &branch_id[..branch_id.len().min(8)];
    let window_label = format!("branch-{}", short_id);

    if let Some(existing) = app.get_webview_window(&window_label) {
        existing.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let url_path = format!(
        "/?branch={}&conv={}&label={}&project={}",
        branch_id, conv_id, label, project_key
    );

    tauri::WebviewWindowBuilder::new(
        &app,
        &window_label,
        tauri::WebviewUrl::App(url_path.into()),
    )
    .title(format!("Branch: {}", label))
    .inner_size(900.0, 700.0)
    .min_inner_size(600.0, 400.0)
    .center()
    .decorations(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn close_branch_window(app: tauri::AppHandle, branch_id: String) -> Result<(), String> {
    let short_id = &branch_id[..branch_id.len().min(8)];
    let window_label = format!("branch-{}", short_id);
    if let Some(window) = app.get_webview_window(&window_label) {
        window.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(std::sync::Mutex::new(SidecarManager::new()));

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_branch_window,
            close_branch_window,
            read_text_file,
            start_sidecar,
            chat_send,
            chat_cancel,
            list_models,
            code_search,
            code_map,
            scan_workspace,
            get_project_context,
        ]);

    #[cfg(mobile)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![greet, read_text_file]);

    builder
        .setup(|_app| {
            // Sidecar is started on first invoke('start_sidecar') from frontend.

            #[cfg(target_os = "linux")]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    if let Some(icon) = _app.default_window_icon() {
                        let _ = window.set_icon(icon.clone());
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
