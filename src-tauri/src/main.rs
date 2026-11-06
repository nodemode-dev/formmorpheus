#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod packaged;
mod folder;
mod recent;
mod reveal;
mod text_edit;
mod traffic_lights;
mod window_state;

const FALLBACK_SIZE: (f64, f64) = (1323.0, 860.0);
const MIN_SIZE: (f64, f64) = (980.0, 640.0);
const SCREEN_FRACTION: f64 = 0.9;
const TITLE: &str = "FormMorpheus";

struct Backend(Mutex<Option<CommandChild>>);

#[derive(Default)]
struct Opens {
    ready: bool,
    paths: Vec<String>,
}

struct OpenQueue(Mutex<Opens>);

fn kill_backend(handle: &tauri::AppHandle) {
    let state = handle.state::<Backend>();
    let child = state.0.lock().ok().and_then(|mut slot| slot.take());
    let Some(child) = child else { return };
    #[cfg(unix)]
    {
        let pid = child.pid().to_string();
        let signal = |sig: &str| {
            std::process::Command::new("kill")
                .args([sig, pid.as_str()])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
        };
        if signal("-TERM") {
            for _ in 0..30 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                if !signal("-0") {
                    return;
                }
            }
        }
    }
    let _ = child.kill();
}

fn close_splash(handle: &tauri::AppHandle) {
    if let Some(splash) = handle.get_webview_window("splash") {
        let _ = splash.close();
    }
}

fn show_main_window(handle: &tauri::AppHandle) {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_paths(handle: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let send = match handle.state::<OpenQueue>().0.lock() {
        Ok(opens) if opens.ready => Some(paths),
        Ok(mut opens) => {
            opens.paths.extend(paths);
            None
        }
        Err(_) => None,
    };
    if let Some(paths) = send {
        let _ = handle.emit("formmorpheus://open-paths", paths);
        show_main_window(handle);
    }
}

fn paths_from_args(args: &[String], cwd: Option<&str>) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = std::path::PathBuf::from(arg);
            let full = match cwd {
                Some(dir) if path.is_relative() => std::path::Path::new(dir).join(path),
                _ => path,
            };
            full.is_file().then(|| full.to_string_lossy().into_owned())
        })
        .collect()
}

#[tauri::command]
fn take_pending_opens(queue: tauri::State<OpenQueue>) -> Vec<String> {
    match queue.0.lock() {
        Ok(mut opens) => {
            opens.ready = true;
            std::mem::take(&mut opens.paths)
        }
        Err(_) => Vec::new(),
    }
}

fn user_data_dir_arg(args: &[String]) -> Option<String> {
    args.iter()
        .enumerate()
        .find_map(|(i, a)| {
            a.strip_prefix("--user-data-dir=")
                .map(str::to_string)
                .or_else(|| (a == "--user-data-dir").then(|| args.get(i + 1).cloned()).flatten())
        })
        .filter(|dir| !dir.is_empty())
}

#[cfg(windows)]
fn portable_web_view_data() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    if dir.join("portable").is_file() || dir.join("portable.txt").is_file() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir.join("FormmorpheusData").join("WebView2"));
    }
}

#[cfg(target_os = "linux")]
fn set_unless_set(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        std::env::set_var(name, value);
    }
}

#[cfg(target_os = "linux")]
fn linux_graphics() {
    let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland");
    if wayland && std::path::Path::new("/proc/driver/nvidia").exists() {
        set_unless_set("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
    match std::env::var("FORMMORPHEUS_SAFE_GRAPHICS").as_deref() {
        Ok("1") => set_unless_set("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        Ok("2") => {
            set_unless_set("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            set_unless_set("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        _ => {}
    }
}

#[cfg(target_os = "linux")]
fn origin_of(url: &str) -> String {
    let after = url.find("://").map_or(0, |i| i + 3);
    let end = url[after..].find('/').map_or(url.len(), |i| after + i);
    url[..end].to_string()
}

#[cfg(target_os = "linux")]
fn allow_own_microphone(window: &tauri::WebviewWindow, origin: String) {
    use webkit2gtk::glib::Cast;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt};
    let _ = window.with_webview(move |platform| {
        let view = platform.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(move |view, request| {
            let own_page = WebViewExt::uri(view)
                .is_some_and(|page| page == origin.as_str() || page.starts_with(&format!("{origin}/")));
            let audio_only = request
                .downcast_ref::<UserMediaPermissionRequest>()
                .is_some_and(|media| media.is_for_audio_device() && !media.is_for_video_device());
            if own_page && audio_only {
                request.allow();
            } else {
                request.deny();
            }
            true
        });
    });
}

fn dev_url() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("FORMMORPHEUS_DEV_URL").ok().filter(|url| !url.is_empty())
    } else {
        None
    }
}

fn build_main(handle: &tauri::AppHandle, url: &str) {
    let Ok(parsed) = url.parse() else {
        close_splash(handle);
        return;
    };
    let place = window_state::load(handle);
    let (width, height) = if place.width > 0.0 {
        (place.width, place.height)
    } else {
        handle
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| {
                let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
                (logical.width * SCREEN_FRACTION, logical.height * SCREEN_FRACTION)
            })
            .unwrap_or(FALLBACK_SIZE)
    };
    let builder = WebviewWindowBuilder::new(handle, "main", WebviewUrl::External(parsed))
        .title(TITLE)
        .visible(reveal::BUILD_VISIBLE)
        .background_color(reveal::BACKGROUND)
        .inner_size(width, height)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .disable_drag_drop_handler();
    let builder = if place.width > 0.0 { builder.position(place.x, place.y) } else { builder.center() };
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let builder = builder.on_page_load(|window, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            traffic_lights::place(&window.as_ref().window());
        }
    });
    match builder.build() {
        Ok(window) => {
            reveal::conceal(&window);
            traffic_lights::place(&window.as_ref().window());
            window_state::restore(&window, &place);
            #[cfg(target_os = "linux")]
            allow_own_microphone(&window, origin_of(url));
        }
        Err(_) => close_splash(handle),
    }
}

fn engine_failed(handle: &tauri::AppHandle) {
    close_splash(handle);
    let _ = handle.dialog().message("The formmorpheus engine failed to start. Please relaunch the app.").blocking_show();
    kill_backend(handle);
    handle.exit(1);
}

fn main() {
    #[cfg(target_os = "linux")]
    linux_graphics();
    reveal::mark_launch();
    #[cfg(windows)]
    portable_web_view_data();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            open_paths(app, paths_from_args(&args, Some(&cwd)));
            show_main_window(app);
        }))
        .manage(OpenQueue(Mutex::new(Opens::default())))
        .manage(window_state::Memory::default())
        .manage(Backend(Mutex::new(None)))
        .on_window_event(|window, event| {
            window_state::track(window, event);
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Focused(_)
                        | tauri::WindowEvent::ThemeChanged(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
            {
                traffic_lights::place(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_opens,
            recent::note_recent_document,
            traffic_lights::set_window_title,
            reveal::app_ready,
            text_edit::text_edit,
            folder::reveal_folder
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            reveal::round_splash(&handle);
            let launch_args: Vec<String> = std::env::args().collect();
            open_paths(&handle, paths_from_args(&launch_args, None));
            if let Some(url) = dev_url() {
                build_main(&handle, &url);
                return Ok(());
            }
            let engine = match packaged::engine_folder() {
                Some(program) => app.shell().command(program),
                None => app.shell().sidecar("formmorpheus-engine").expect("the formmorpheus engine sidecar is missing; bundle its binary"),
            };
            let mut engine = engine.env("FORMMORPHEUS_PORT", "0");
            if let Some(dir) = user_data_dir_arg(&launch_args) {
                engine = engine.env("FORMMORPHEUS_DATA_DIR", dir);
            }
            if launch_args.iter().any(|a| a == "--portable") {
                engine = engine.env("FORMMORPHEUS_PORTABLE", "1");
            }
            let (mut rx, child) = engine.spawn().expect("the formmorpheus engine failed to spawn");
            *app.state::<Backend>().0.lock().unwrap() = Some(child);

            tauri::async_runtime::spawn(async move {
                let pattern = regex::Regex::new(r"http://127\.0\.0\.1:(\d+)").unwrap();
                let mut port: Option<u16> = None;
                while let Some(event) = rx.recv().await {
                    let text = match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                        CommandEvent::Terminated(_) => break,
                        _ => continue,
                    };
                    if let Some(found) = pattern.captures(&text).and_then(|c| c[1].parse::<u16>().ok()) {
                        port = Some(found);
                        break;
                    }
                }
                match port {
                    Some(port) => build_main(&handle, &format!("http://127.0.0.1:{port}")),
                    None => engine_failed(&handle),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the formmorpheus app");

    app.run(|handle, event| match event {
        RunEvent::Exit => {
            window_state::flush(handle);
            kill_backend(handle);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let paths = urls.iter().filter_map(|url| url.to_file_path().ok()).map(|path| path.to_string_lossy().into_owned()).collect();
            open_paths(handle, paths);
            show_main_window(handle);
        }
        _ => {}
    });
}
