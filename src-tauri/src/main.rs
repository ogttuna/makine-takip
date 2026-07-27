#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut config = collector::config::CollectorConfig::from_env()?;

            if std::env::var_os("FREEZEDRY_DB_URL").is_none() {
                let data_directory = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_directory)?;
                let database_path = data_directory.join("freezedry.db");
                config.database_url = format!(
                    "sqlite://{}",
                    database_path.to_string_lossy().replace('\\', "/")
                );
            }

            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    collector::server::serve_with_shutdown(config, std::future::pending::<()>())
                        .await
                {
                    eprintln!("embedded collector stopped: {error:#}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FreezeDryMachine desktop shell");
}
