//! Local MCP servers over stdio. The frontend speaks JSON-RPC; this side only starts the process,
//! writes lines to its stdin and forwards each stdout line as an `mcp-stdout` event.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};

struct Server {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, Arc<tokio::sync::Mutex<Server>>>>);

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    line: String,
}

/// Starts `command` through cmd.exe (so `npx …`, `uvx …` and .cmd shims work), replacing a server with the same id.
#[tauri::command]
pub async fn mcp_start(app: AppHandle, servers: State<'_, Servers>, id: String, command: String, cwd: Option<String>) -> Result<(), String> {
    stop(&servers, &id).await;
    let mut cmd = tokio::process::Command::new("cmd.exe");
    cmd.args(["/D", "/S", "/C", &command])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("启动不了：{e}"))?;
    let stdin = child.stdin.take().ok_or("拿不到 stdin")?;
    let stdout = child.stdout.take().ok_or("拿不到 stdout")?;
    let stderr = child.stderr.take();

    let (app2, id2) = (app.clone(), id.clone());
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app2.emit("mcp-stdout", Line { id: id2.clone(), line });
        }
        let _ = app2.emit("mcp-exit", Line { id: id2, line: String::new() });
    });
    // Servers log to stderr; keep the last lines so a failed start can be explained.
    if let Some(err) = stderr {
        let (app3, id3) = (app, id.clone());
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app3.emit("mcp-stderr", Line { id: id3.clone(), line });
            }
        });
    }
    servers.0.lock().unwrap().insert(id, Arc::new(tokio::sync::Mutex::new(Server { child, stdin })));
    Ok(())
}

#[tauri::command]
pub async fn mcp_send(servers: State<'_, Servers>, id: String, line: String) -> Result<(), String> {
    let server = servers.0.lock().unwrap().get(&id).cloned().ok_or("服务没有启动")?;
    let mut s = server.lock().await;
    s.stdin.write_all(format!("{line}\n").as_bytes()).await.map_err(|e| format!("服务已退出：{e}"))?;
    s.stdin.flush().await.map_err(|e| e.to_string())
}

async fn stop(servers: &Servers, id: &str) {
    let server = servers.0.lock().unwrap().remove(id);
    if let Some(s) = server {
        let _ = s.lock().await.child.kill().await;
    }
}

#[tauri::command]
pub async fn mcp_stop(servers: State<'_, Servers>, id: String) -> Result<(), String> {
    stop(&servers, &id).await;
    Ok(())
}
