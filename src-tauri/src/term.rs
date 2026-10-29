//! The terminal panel: real shells (PowerShell on Windows) in a pseudo-terminal. What a shell prints is sent
//! to the page as `term-data` events; the page sends keystrokes back with `term_write`.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct Term {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terms(Mutex<HashMap<String, Term>>);

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone)]
struct Data {
    id: String,
    data: String,
}

fn shell() -> CommandBuilder {
    if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        cmd
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()))
    }
}

/// Starts a shell in `cwd` (the home folder when it's missing) and returns its id.
#[tauri::command]
pub fn term_open(app: AppHandle, terms: State<Terms>, cwd: Option<String>, cols: u16, rows: u16) -> Result<String, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("打不开终端：{e}"))?;
    let mut cmd = shell();
    match cwd.filter(|c| Path::new(c).is_dir()) {
        Some(dir) => cmd.cwd(dir),
        None => {
            if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
                cmd.cwd(home);
            }
        }
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("启动 PowerShell 失败：{e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = format!("term-{}", NEXT.fetch_add(1, Ordering::Relaxed));

    let tid = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // A character can be split across two reads; its first bytes wait here for the rest.
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    if !data.is_empty() {
                        let _ = app.emit("term-data", Data { id: tid.clone(), data });
                    }
                }
            }
        }
        let _ = app.emit("term-exit", tid);
    });

    terms.0.lock().unwrap().insert(id.clone(), Term { writer, master: pair.master, child });
    Ok(id)
}

/// Keystrokes and pasted text from the page.
#[tauri::command]
pub fn term_write(terms: State<Terms>, id: String, data: String) -> Result<(), String> {
    let mut all = terms.0.lock().unwrap();
    let t = all.get_mut(&id).ok_or("终端已关闭")?;
    t.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    t.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(terms: State<Terms>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let all = terms.0.lock().unwrap();
    let t = all.get(&id).ok_or("终端已关闭")?;
    t.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_close(terms: State<Terms>, id: String) {
    if let Some(mut t) = terms.0.lock().unwrap().remove(&id) {
        let _ = t.child.kill();
    }
}
