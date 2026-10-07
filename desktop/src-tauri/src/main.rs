// Tally desktop: a thin native window around the same web app that runs in
// the browser and on Android. All logic lives in ../../app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // Save dialogs + file writing for backups and exports.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Tally");
}
