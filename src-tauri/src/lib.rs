#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // El solver está íntegramente en TypeScript; Rust solo hospeda la UI.
        .run(tauri::generate_context!())
        .expect("Error al iniciar WallTRUX Studio");
}
