use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const APP: &str = "FormMorpheus";
pub const SHELL_ENV: &str = "FORMMORPHEUS_SHELL_PID";
pub const DATA_ENV: &str = "FORMMORPHEUS_DATA_DIR";
pub const PORT_PREFER: &str = "9496";
pub const ADDRESS_WAIT: Duration = Duration::from_secs(90);
pub const EXIT_WAIT: Duration = Duration::from_secs(1);
pub const BUSY_CODE: i32 = 2;
const DATA_NAME: &str = "formmorpheus";
const LOG_FOLDER: &str = "Logs";
const LOG_NAME: &str = "formmorpheus-engine.log";
const KEY_MARK: &str = "window-key";
const TAIL_LINES: usize = 12;
const LINE_CHARS: usize = 300;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wait {
    Address,
}

impl Wait {
    pub fn limit(self) -> Duration {
        match self {
            Wait::Address => ADDRESS_WAIT,
        }
    }

    pub fn what(self) -> &'static str {
        match self {
            Wait::Address => "its engine to say which address it serves on",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Failure {
    Missing,
    NotStarted(String),
    Stopped(Option<i32>),
    TimedOut(Wait),
    Window,
    Lost(Option<i32>),
}

#[derive(Default)]
pub struct Tail(VecDeque<String>);

impl Tail {
    pub fn push(&mut self, line: &str) {
        if line.contains(KEY_MARK) {
            return;
        }
        let clean: String = line.chars().filter(|c| !c.is_control()).take(LINE_CHARS).collect();
        if clean.trim().is_empty() {
            return;
        }
        if self.0.len() == TAIL_LINES {
            self.0.pop_front();
        }
        self.0.push_back(clean);
    }

    pub fn lines(&self) -> Vec<String> {
        self.0.iter().cloned().collect()
    }
}

pub fn sentence(failure: &Failure) -> String {
    match failure {
        Failure::Missing => format!("{APP} could not start: its engine program is missing from the install. Installing {APP} again puts it back."),
        Failure::NotStarted(reason) => format!("{APP} could not start its engine: {reason}"),
        Failure::Stopped(Some(BUSY_CODE)) => format!("{APP} could not start: another copy of its engine holds its data folder."),
        Failure::Stopped(Some(code)) => format!("{APP} could not start: its engine stopped with code {code} before the window could open."),
        Failure::Stopped(None) => format!("{APP} could not start: its engine stopped before the window could open."),
        Failure::TimedOut(wait) => format!("{APP} could not start: it waited {} seconds for {} and that did not happen.", wait.limit().as_secs(), wait.what()),
        Failure::Window => format!("{APP} could not open its window."),
        Failure::Lost(Some(code)) => format!("{APP} has to close: its engine stopped with code {code}. Your movies are saved as you work; open {APP} again to go on."),
        Failure::Lost(None) => format!("{APP} has to close: its engine stopped. Your movies are saved as you work; open {APP} again to go on."),
    }
}

pub fn message(failure: &Failure, tail: &[String], log: Option<&Path>) -> String {
    let mut text = sentence(failure);
    if !tail.is_empty() {
        text.push_str("\n\nThe engine's last lines:\n");
        text.push_str(&tail.join("\n"));
    } else if matches!(failure, Failure::Stopped(_) | Failure::TimedOut(_) | Failure::Lost(_)) {
        text.push_str("\n\nThe engine wrote nothing before that.");
    }
    if let Some(path) = log {
        text.push_str("\n\nThe engine's log: ");
        text.push_str(&path.to_string_lossy());
    }
    text
}

pub fn home(os: &str, var: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let name = if os == "windows" { "USERPROFILE" } else { "HOME" };
    var(name).filter(|value| !value.is_empty()).map(PathBuf::from)
}

pub fn data_folder(os: &str, var: &dyn Fn(&str) -> Option<String>, given: Option<&str>) -> Option<PathBuf> {
    let set = |name: &str| var(name).map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    let home = home(os, var);
    if let Some(raw) = given.map(str::to_string).filter(|value| !value.is_empty()).or_else(|| set(DATA_ENV)) {
        return match (raw.strip_prefix('~'), &home) {
            (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') => {
                Some(home.join(rest.trim_start_matches(['/', '\\'])))
            }
            _ => Some(PathBuf::from(raw)),
        };
    }
    match os {
        "macos" => home.map(|home| home.join("Library").join("Application Support").join(DATA_NAME)),
        "windows" => set("APPDATA")
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join("AppData").join("Roaming")))
            .map(|base| base.join(DATA_NAME)),
        _ => set("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|base| base.is_absolute())
            .or_else(|| home.map(|home| home.join(".local").join("share")))
            .map(|base| base.join(DATA_NAME)),
    }
}

pub fn engine_log(given: Option<&str>) -> Option<PathBuf> {
    data_folder(std::env::consts::OS, &|name| std::env::var(name).ok(), given).map(|folder| folder.join(LOG_FOLDER).join(LOG_NAME))
}
