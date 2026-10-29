mod browser;
mod files;
mod jobs;
mod mcp;
mod term;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opening the app again brings the running window forward instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.webview_windows().values().next() {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(mcp::Servers::default())
        .manage(jobs::Jobs::default())
        .manage(term::Terms::default())
        .invoke_handler(tauri::generate_handler![
            workspace::ws_list,
            workspace::ws_read,
            workspace::ws_peek,
            workspace::ws_search,
            workspace::ws_files,
            workspace::ws_read_bytes,
            workspace::ws_recent,
            workspace::ws_exists,
            workspace::ws_write,
            workspace::ws_write_bytes,
            workspace::ws_delete,
            workspace::run_command,
            files::save_file,
            files::reveal,
            files::open_file,
            files::open_url,
            files::find_skills,
            mcp::mcp_start,
            mcp::mcp_send,
            mcp::mcp_stop,
            jobs::job_start,
            jobs::job_output,
            jobs::job_stop,
            jobs::job_list,
            jobs::job_forget,
            browser::web_open,
            browser::web_place,
            browser::web_navigate,
            browser::web_go,
            browser::web_close,
            browser::web_eval,
            browser::web_reset,
            term::term_open,
            term::term_write,
            term::term_resize,
            term::term_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 研伴");
}
