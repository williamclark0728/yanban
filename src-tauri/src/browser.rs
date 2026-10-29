//! The built-in browser: each tab is a WebView2 child view laid over a box in the page (the page sends its
//! bounds). It shares the app's WebView2 profile, so sites the user signs into stay signed in.
//! The page also runs scripts in a tab (`web_eval`) to read it for the agents.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone)]
struct WebState {
    label: String,
    url: Option<String>,
    title: Option<String>,
    loading: Option<bool>,
}

/// Links that open a new tab or window open in the same view instead.
const SAME_VIEW: &str = r#"
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
  if (a && a.target !== '_self' && a.href) a.target = '_self';
}, true);
"#;

fn parse(url: &str) -> Result<Url, String> {
    let url = url.trim();
    let full = if url.contains("://") { url.to_string() } else { format!("https://{url}") };
    let parsed = Url::parse(&full).map_err(|e| format!("网址不对：{e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只能打开 http 或 https 网址".into());
    }
    Ok(parsed)
}

fn webview(app: &AppHandle, label: &str) -> Result<tauri::Webview, String> {
    app.get_webview(label).ok_or_else(|| "这个浏览器标签已经关了".to_string())
}

/// Opens a tab at `url`, placed at the given box (logical pixels of the window). Returns its label.
#[tauri::command]
pub async fn web_open(app: AppHandle, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    let url = parse(&url)?;
    let label = format!("web-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let window = app.get_window("main").ok_or("找不到主窗口")?;
    let (a, b, c) = (app.clone(), app.clone(), app.clone());
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .initialization_script(SAME_VIEW)
        .on_page_load(move |view, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let _ = a.emit("web-state", WebState { label: view.label().into(), url: Some(payload.url().to_string()), title: None, loading: Some(loading) });
        })
        .on_document_title_changed(move |view, title| {
            let _ = b.emit("web-state", WebState { label: view.label().into(), url: None, title: Some(title), loading: None });
        })
        .on_navigation(move |url| {
            // Only web pages; other schemes (mailto:, app links) would leave the browser.
            let ok = matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data");
            if !ok {
                let _ = c.emit("web-external", url.to_string());
            }
            ok
        });
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w.max(1.0), h.max(1.0)))
        .map_err(|e| format!("打不开浏览器：{e}"))?;
    Ok(label)
}

/// Moves a tab over its box, or hides it (another tab, the panel closed, a dialog in front).
#[tauri::command]
pub async fn web_place(app: AppHandle, label: String, x: f64, y: f64, w: f64, h: f64, visible: bool) -> Result<(), String> {
    let view = webview(&app, &label)?;
    if !visible {
        return view.hide().map_err(|e| e.to_string());
    }
    view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    view.set_size(LogicalSize::new(w.max(1.0), h.max(1.0))).map_err(|e| e.to_string())?;
    view.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn web_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    webview(&app, &label)?.navigate(parse(&url)?).map_err(|e| e.to_string())
}

/// Back, forward or reload.
#[tauri::command]
pub async fn web_go(app: AppHandle, label: String, to: String) -> Result<(), String> {
    let view = webview(&app, &label)?;
    match to.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        _ => view.reload(),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn web_close(app: AppHandle, label: String) {
    if let Some(view) = app.get_webview(&label) {
        let _ = view.close();
    }
}

/// Runs a script in a tab and returns its result as JSON text (WebView2's ExecuteScript).
#[tauri::command]
pub async fn web_eval(app: AppHandle, label: String, script: String) -> Result<String, String> {
    let view = webview(&app, &label)?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    run_script(&view, script, tx)?;
    tokio::time::timeout(std::time::Duration::from_secs(20), rx)
        .await
        .map_err(|_| "页面脚本 20 秒没有返回".to_string())?
        .map_err(|_| "页面脚本没有返回".to_string())?
}

#[cfg(windows)]
fn run_script(view: &tauri::Webview, script: String, tx: tokio::sync::oneshot::Sender<Result<String, String>>) -> Result<(), String> {
    use webview2_com::ExecuteScriptCompletedHandler;
    view.with_webview(move |platform| unsafe {
        let sent = (|| -> windows_core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let tx = std::sync::Mutex::new(Some(tx));
            let handler = ExecuteScriptCompletedHandler::create(Box::new(move |error, result| {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(error.map(|_| result).map_err(|e| e.to_string()));
                }
                Ok(())
            }));
            core.ExecuteScript(&windows_core::HSTRING::from(script), &handler)
        })();
        if let Err(e) = sent {
            eprintln!("web_eval: {e}");
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn run_script(_view: &tauri::Webview, _script: String, tx: tokio::sync::oneshot::Sender<Result<String, String>>) -> Result<(), String> {
    let _ = tx.send(Err("只有 Windows 版支持读取内置浏览器的页面".into()));
    Ok(())
}

/// Closes every browser tab; the page calls this when it starts, so a reload leaves no stray views.
#[tauri::command]
pub async fn web_reset(app: AppHandle) {
    for (label, view) in app.webviews() {
        if label.starts_with("web-") {
            let _ = view.close();
        }
    }
}
