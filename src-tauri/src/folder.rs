use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const APP: &str = "formmorpheus";

/// Where the engine keeps its data: the same choices backend/app/core/config.py makes (an explicit folder, the
/// portable folder beside the program, else the per-user default).
fn data_folders() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let args: Vec<String> = std::env::args().collect();
    if let Some(dir) = args.iter().enumerate().find_map(|(i, a)| {
        a.strip_prefix("--user-data-dir=").map(str::to_string).or_else(|| (a == "--user-data-dir").then(|| args.get(i + 1).cloned()).flatten())
    }) {
        out.push(PathBuf::from(dir));
    }
    if let Ok(dir) = std::env::var("FORMMORPHEUS_DATA_DIR") {
        out.push(PathBuf::from(dir));
    }
    if let Some(beside) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        out.push(beside.join("FormmorpheusData"));
        if let Some(up) = beside.parent() {
            out.push(up.join("FormmorpheusData"));
        }
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        out.extend(home.map(|h| h.join("Library").join("Application Support").join(APP)));
    } else if cfg!(windows) {
        out.push(std::env::var_os("APPDATA").map(PathBuf::from).or_else(|| home.map(|h| h.join("AppData").join("Roaming"))).unwrap_or_default().join(APP));
    } else {
        let base = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute());
        out.extend(base.or_else(|| home.map(|h| h.join(".local").join("share"))).map(|b| b.join(APP)));
    }
    out
}

/// The folder to open, only when it exists, is a folder, and (after links and `..` are resolved) sits inside the engine's data folder.
fn checked(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.len() > 1000 || raw.contains('\0') {
        return Err("That folder cannot be opened.".into());
    }
    let wanted = Path::new(raw);
    if !wanted.is_absolute() {
        return Err("Give the full path of the folder.".into());
    }
    let real = wanted.canonicalize().map_err(|_| "That folder does not exist.".to_string())?;
    if !real.is_dir() {
        return Err("That path is not a folder.".into());
    }
    let inside = data_folders().iter().filter_map(|d| d.canonicalize().ok()).any(|d| real.starts_with(&d));
    if inside {
        Ok(real)
    } else {
        Err("Only folders inside the formmorpheus data folder can be opened.".into())
    }
}

/// Shows a folder of the engine's data folder in the system file browser (the shell plugin's open only takes web addresses).
#[tauri::command]
pub fn reveal_folder(path: String) -> Result<(), String> {
    let folder = checked(&path)?;
    let (program, arg) = if cfg!(target_os = "macos") {
        ("open", folder.into_os_string())
    } else if cfg!(windows) {
        // canonicalize gives a \\?\ path, which the file browser does not take
        let text = folder.to_string_lossy().into_owned();
        ("explorer", std::ffi::OsString::from(text.strip_prefix(r"\\?\").unwrap_or(&text)))
    } else {
        ("xdg-open", folder.into_os_string())
    };
    Command::new(program).arg(arg).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("Could not open the folder: {e}"))
}
