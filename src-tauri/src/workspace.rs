//! Work mode: file access and commands inside one folder the user picked.
//! Every path is checked to stay inside the workspace; approvals happen in the frontend before these run.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

const MAX_READ: u64 = 2 * 1024 * 1024;
const MAX_OUTPUT: usize = 30_000;

/// Resolves `rel` against the workspace root and refuses anything that ends up outside it,
/// including through `..` or a symbolic link.
fn inside(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = dunce::canonicalize(root).map_err(|e| format!("工作区文件夹打不开：{e}"))?;
    let rel = rel.trim();
    let joined = if Path::new(rel).is_absolute() { PathBuf::from(rel) } else { root.join(rel) };
    let mut path = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::ParentDir => {
                path.pop();
            }
            Component::CurDir => {}
            other => path.push(other),
        }
    }
    let mut existing = path.clone();
    while !existing.exists() && existing.pop() {}
    let real = dunce::canonicalize(&existing).unwrap_or(existing);
    if !path.starts_with(&root) || !real.starts_with(&root) {
        return Err(format!("{rel} 不在工作区内"));
    }
    Ok(path)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
    size: u64,
}

#[tauri::command]
pub async fn ws_list(root: String, path: String) -> Result<Vec<Entry>, String> {
    let dir = inside(&root, &path)?;
    let mut entries: Vec<Entry> = std::fs::read_dir(&dir)
        .map_err(|e| format!("读不了 {path}：{e}"))?
        .filter_map(|e| e.ok())
        .map(|e| {
            let meta = e.metadata().ok();
            Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                dir: meta.as_ref().is_some_and(|m| m.is_dir()),
                size: meta.map(|m| m.len()).unwrap_or(0),
            }
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    entries.truncate(500);
    Ok(entries)
}

#[tauri::command]
pub async fn ws_read(root: String, path: String) -> Result<String, String> {
    let file = inside(&root, &path)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("找不到 {path}：{e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} 是文件夹"));
    }
    if meta.len() > MAX_READ {
        return Err(format!("{path} 太大（{} KB），只能读 2 MB 以内的文件", meta.len() / 1024));
    }
    let bytes = std::fs::read(&file).map_err(|e| format!("读不了 {path}：{e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Like `ws_read`, but a missing file is `None` instead of an error (for showing what a write will change).
#[tauri::command]
pub async fn ws_peek(root: String, path: String) -> Result<Option<String>, String> {
    let file = inside(&root, &path)?;
    if !file.is_file() {
        return Ok(None);
    }
    ws_read(root, path).await.map(Some)
}

#[derive(Serialize)]
pub struct Hit {
    path: String,
    line: usize,
    text: String,
}

/// Regex search through text files, skipping what .gitignore excludes, hidden files, binaries and large files.
#[tauri::command]
pub async fn ws_search(root: String, pattern: String, path: Option<String>, glob: Option<String>) -> Result<Vec<Hit>, String> {
    let base = dunce::canonicalize(&root).map_err(|e| format!("工作区文件夹打不开：{e}"))?;
    let start = inside(&root, path.as_deref().unwrap_or("."))?;
    let re = regex::Regex::new(&pattern).map_err(|e| format!("正则写错了：{e}"))?;
    let filter = match glob.filter(|g| !g.trim().is_empty()) {
        Some(g) => Some(globset::Glob::new(&g).map_err(|e| format!("glob 写错了：{e}"))?.compile_matcher()),
        None => None,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut hits = Vec::new();
        for entry in ignore::WalkBuilder::new(&start).build().filter_map(|e| e.ok()) {
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                continue;
            }
            let rel = relative(&base, entry.path());
            let name = entry.file_name().to_string_lossy();
            if let Some(f) = &filter {
                if !f.is_match(&rel) && !f.is_match(name.as_ref()) {
                    continue;
                }
            }
            if entry.metadata().map(|m| m.len() > 1024 * 1024).unwrap_or(true) {
                continue;
            }
            let Ok(bytes) = std::fs::read(entry.path()) else { continue };
            if bytes.iter().take(8000).any(|b| *b == 0) {
                continue;
            }
            for (i, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
                if re.is_match(line) {
                    hits.push(Hit { path: rel.clone(), line: i + 1, text: line.chars().take(300).collect() });
                    if hits.len() >= 200 {
                        return Ok(hits);
                    }
                }
            }
        }
        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes a file (creating folders as needed) and returns what was there before, for undo.
#[tauri::command]
pub async fn ws_write(root: String, path: String, content: String) -> Result<Option<String>, String> {
    let file = inside(&root, &path)?;
    if file.is_dir() {
        return Err(format!("{path} 是文件夹"));
    }
    let before = if file.is_file() { std::fs::read(&file).ok().map(|b| String::from_utf8_lossy(&b).into_owned()) } else { None };
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("建不了文件夹：{e}"))?;
    }
    std::fs::write(&file, content).map_err(|e| format!("写不了 {path}：{e}"))?;
    Ok(before)
}

/// Removes a file; used to undo creating it.
#[tauri::command]
pub async fn ws_delete(root: String, path: String) -> Result<(), String> {
    let file = inside(&root, &path)?;
    if !file.is_file() {
        return Err(format!("{path} 不是文件"));
    }
    std::fs::remove_file(&file).map_err(|e| format!("删不了 {path}：{e}"))
}

#[derive(Serialize)]
pub struct CommandOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

/// Keeps the start and the end of long output.
fn clip(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= MAX_OUTPUT {
        return text.into_owned();
    }
    let half = MAX_OUTPUT / 2;
    format!(
        "{}\n…（中间省略 {} 字）…\n{}",
        chars[..half].iter().collect::<String>(),
        chars.len() - MAX_OUTPUT,
        chars[chars.len() - half..].iter().collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::inside;

    #[test]
    fn stays_inside_the_workspace() {
        let root = std::env::temp_dir().join("yanban-ws-test");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let r = root.to_str().unwrap();
        assert!(inside(r, "sub/new.txt").is_ok());
        assert!(inside(r, "./sub/../a.txt").is_ok());
        assert!(inside(r, ".").is_ok());
        assert!(inside(r, "../escape.txt").is_err());
        assert!(inside(r, "sub/../../escape.txt").is_err());
        assert!(inside(r, "C:\\Windows\\win.ini").is_err());
        let own = root.join("sub").join("x.txt");
        assert!(inside(r, own.to_str().unwrap()).is_ok());
    }
}

/// Runs one PowerShell command in the workspace, with UTF-8 output and a time limit.
#[tauri::command]
pub async fn run_command(root: String, command: String, timeout_secs: Option<u64>) -> Result<CommandOutput, String> {
    let dir = inside(&root, ".")?;
    let script = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; {command}");
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let child = cmd.spawn().map_err(|e| format!("启动不了 PowerShell：{e}"))?;
    let limit = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(1, 600));
    match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(Ok(out)) => Ok(CommandOutput { code: out.status.code(), stdout: clip(&out.stdout), stderr: clip(&out.stderr), timed_out: false }),
        Ok(Err(e)) => Err(format!("命令出错：{e}")),
        // Dropping the future kills the process (kill_on_drop).
        Err(_) => Ok(CommandOutput { code: None, stdout: String::new(), stderr: String::new(), timed_out: true }),
    }
}
