//! Background commands: long jobs (training, builds, servers) that keep running while the agent and the user
//! do other things. Output is kept per job (the most recent part) and read back by offset.

use crate::workspace::inside;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

/// Bytes of output kept per job; older output is dropped from the front.
const KEEP: usize = 400_000;

struct Job {
    command: String,
    root: String,
    started: u64,
    /// Output from byte `base` of everything the job printed.
    log: String,
    base: usize,
    done: bool,
    code: Option<i32>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Arc<Mutex<Job>>>>);

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
pub struct JobInfo {
    id: String,
    command: String,
    root: String,
    started: u64,
    done: bool,
    code: Option<i32>,
    /// Total bytes printed so far.
    size: usize,
}

#[derive(Serialize)]
pub struct JobOutput {
    text: String,
    /// Pass this as `since` next time to get only what came after.
    next: usize,
    done: bool,
    code: Option<i32>,
    /// Part of the requested output was already dropped.
    cut: bool,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn append(job: &Arc<Mutex<Job>>, line: &str) {
    let mut j = job.lock().unwrap();
    j.log.push_str(line);
    j.log.push('\n');
    if j.log.len() > KEEP * 2 {
        let mut cut = j.log.len() - KEEP;
        while !j.log.is_char_boundary(cut) {
            cut += 1;
        }
        j.log.drain(..cut);
        j.base += cut;
    }
}

fn pump<R: AsyncRead + Unpin + Send + 'static>(job: Arc<Mutex<Job>>, reader: R) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            append(&job, &line);
        }
    });
}

/// Starts a PowerShell command in the workspace and returns its id right away.
#[tauri::command]
pub async fn job_start(jobs: State<'_, Jobs>, root: String, command: String) -> Result<String, String> {
    let dir = inside(&root, ".")?;
    let script = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; {command}");
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("启动不了 PowerShell：{e}"))?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let id = format!("job-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let job = Arc::new(Mutex::new(Job { command, root, started: now_ms(), log: String::new(), base: 0, done: false, code: None, stop: Some(tx) }));
    if let Some(out) = child.stdout.take() {
        pump(job.clone(), out);
    }
    if let Some(err) = child.stderr.take() {
        pump(job.clone(), err);
    }
    let watched = job.clone();
    tauri::async_runtime::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = rx => {
                let _ = child.kill().await;
                None
            }
        };
        let mut j = watched.lock().unwrap();
        j.done = true;
        j.code = code;
        j.stop = None;
    });
    jobs.0.lock().unwrap().insert(id.clone(), job);
    Ok(id)
}

/// Output since byte `since` (or the last `tail` bytes when `since` is left out).
#[tauri::command]
pub fn job_output(jobs: State<'_, Jobs>, id: String, since: Option<usize>, tail: Option<usize>) -> Result<JobOutput, String> {
    let job = jobs.0.lock().unwrap().get(&id).cloned().ok_or(format!("没有 {id} 这个后台任务"))?;
    let j = job.lock().unwrap();
    let end = j.base + j.log.len();
    let mut from = match since {
        Some(s) => s,
        None => end.saturating_sub(tail.unwrap_or(8_000)),
    };
    let cut = from < j.base;
    from = from.clamp(j.base, end);
    let mut start = from - j.base;
    while !j.log.is_char_boundary(start) {
        start += 1;
    }
    Ok(JobOutput { text: j.log[start..].to_string(), next: end, done: j.done, code: j.code, cut })
}

#[tauri::command]
pub fn job_stop(jobs: State<'_, Jobs>, id: String) -> Result<(), String> {
    let job = jobs.0.lock().unwrap().get(&id).cloned().ok_or(format!("没有 {id} 这个后台任务"))?;
    if let Some(tx) = job.lock().unwrap().stop.take() {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn job_list(jobs: State<'_, Jobs>) -> Vec<JobInfo> {
    let mut list: Vec<JobInfo> = jobs
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|(id, job)| {
            let j = job.lock().unwrap();
            JobInfo { id: id.clone(), command: j.command.clone(), root: j.root.clone(), started: j.started, done: j.done, code: j.code, size: j.base + j.log.len() }
        })
        .collect();
    list.sort_by_key(|j| j.started);
    list
}
