//! Files outside any workspace, always at the user's request: saving a download, showing it in Explorer,
//! and finding the SKILL.md files in a folder the user picked.

use std::path::{Path, PathBuf};

/// Writes a file to the path the user chose in the save dialog.
#[tauri::command]
pub async fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("保存失败：{e}"))
}

/// Opens Explorer with the file selected.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.replace('/', "\\")))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打不开资源管理器：{e}"))
}

fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if depth > 0 && !name.starts_with('.') && name != "node_modules" {
                walk(&path, depth - 1, found);
            }
        } else if entry.file_name().eq_ignore_ascii_case("SKILL.md") {
            found.push(path);
        }
        if found.len() >= 200 {
            return;
        }
    }
}

/// A skill on disk: its folder and the text of its SKILL.md.
#[derive(serde::Serialize)]
pub struct SkillFile {
    dir: String,
    text: String,
}

/// Finds SKILL.md in `path` (a folder or the file itself) and up to four folder levels below it.
#[tauri::command]
pub async fn find_skills(path: String) -> Result<Vec<SkillFile>, String> {
    let start = dunce::canonicalize(path.trim()).map_err(|e| format!("找不到 {path}：{e}"))?;
    let mut found = Vec::new();
    if start.is_file() {
        found.push(start);
    } else {
        walk(&start, 4, &mut found);
    }
    Ok(found
        .into_iter()
        .filter_map(|file| {
            let text = std::fs::read_to_string(&file).ok()?;
            let dir = file.parent()?.to_string_lossy().into_owned();
            Some(SkillFile { dir, text })
        })
        .collect())
}
