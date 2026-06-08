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

/// Tauri's `resource_dir()` returns a Windows extended-length path (`\\?\C:\...`).
/// Node's main-module resolver can't `realpath` that form (it fails with
/// `EISDIR: lstat 'C:'`), so strip the verbatim prefix before handing paths to node.
fn plain_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

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

            // The sidecar is a copy of the official (signed) node.exe; we run the
            // bundled backend script with it. Resources land under <resource_dir>/backend
            // (older Tauri layouts nest them under resources/backend — handle both).
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("failed to resolve resource dir");
            let mut backend_dir = resource_dir.join("backend");
            if !backend_dir.join("server.cjs").exists() {
                backend_dir = resource_dir.join("resources").join("backend");
            }
            let server_entry = backend_dir.join("server.cjs");
            let migrations_dir = backend_dir.join("drizzle");

            // Backend writes data (sqlite.db, .data/images, backups) relative to its
            // working dir / home, so run it from the writable per-user data folder.
            let data_dir = app_data_dir();
            let _ = fs::create_dir_all(&data_dir);

            append_sidecar_log(format!(
                "Launching backend: node \"{}\" (cwd={})",
                server_entry.display(),
                data_dir.display()
            ));

            match app.shell().sidecar("app-server").map(|command| {
                command
                    .arg(plain_path(&server_entry))
                    .current_dir(&data_dir)
                    .env("ERP_PACKAGED", "1")
                    .env("PORT", "4000")
                    .env("ERP_MIGRATIONS_DIR", plain_path(&migrations_dir))
            }) {
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
