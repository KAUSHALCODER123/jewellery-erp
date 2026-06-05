use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::SystemTime,
};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct SidecarState(Mutex<Option<CommandChild>>);

fn app_data_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".shree-erp")
}

fn append_sidecar_log(message: impl AsRef<str>) {
    let log_path = app_data_dir().join("crash_log.txt");
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "[{:?}] {}", SystemTime::now(), message.as_ref());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(SidecarState(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            match app.shell().sidecar("app-server") {
                Ok(command) => match command.spawn() {
                    Ok((mut receiver, child)) => {
                        append_sidecar_log(format!("Started bundled backend sidecar pid={}", child.pid()));
                        *app.state::<SidecarState>().0.lock().expect("sidecar lock poisoned") =
                            Some(child);

                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = receiver.recv().await {
                                match event {
                                    CommandEvent::Stdout(bytes) => append_sidecar_log(format!(
                                        "Sidecar STDOUT: {}",
                                        String::from_utf8_lossy(&bytes)
                                    )),
                                    CommandEvent::Stderr(bytes) => append_sidecar_log(format!(
                                        "Sidecar STDERR: {}",
                                        String::from_utf8_lossy(&bytes)
                                    )),
                                    CommandEvent::Error(error) => {
                                        append_sidecar_log(format!("Sidecar error: {error}"))
                                    }
                                    CommandEvent::Terminated(payload) => append_sidecar_log(format!(
                                        "Sidecar terminated code={:?} signal={:?}",
                                        payload.code, payload.signal
                                    )),
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(error) => append_sidecar_log(format!("Failed to spawn sidecar: {error}")),
                },
                Err(error) => append_sidecar_log(format!("Failed to resolve sidecar: {error}")),
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<SidecarState>();
            let child = state.0.lock().expect("sidecar lock poisoned").take();

            if let Some(child) = child {
                append_sidecar_log("Stopping bundled backend sidecar");
                if let Err(error) = child.kill() {
                    append_sidecar_log(format!("Failed to stop sidecar: {error}"));
                }
            }
        }
    });
}
