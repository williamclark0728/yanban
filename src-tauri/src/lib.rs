mod mcp;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(mcp::Servers::default())
        .invoke_handler(tauri::generate_handler![
            workspace::ws_list,
            workspace::ws_read,
            workspace::ws_peek,
            workspace::ws_search,
            workspace::ws_write,
            workspace::ws_delete,
            workspace::run_command,
            mcp::mcp_start,
            mcp::mcp_send,
            mcp::mcp_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 研伴");
}
