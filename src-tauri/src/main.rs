#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod models;

fn main() {
    let conn = db::open().expect("Failed to open database");
    db::initialize(&conn).expect("Failed to initialize database");
    drop(conn);

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_next_workout_type,
            commands::start_workout,
            commands::get_active_workout,
            commands::complete_set,
            commands::complete_workout,
            commands::override_weight,
            commands::get_workout_history,
            commands::get_exercise_progression,
            commands::get_program_config,
            commands::update_program_config,
            commands::get_exercises,
            commands::update_exercise,
            commands::cancel_workout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
