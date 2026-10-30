/// Adds a file the person opened or saved to the system's recent documents (the desktop's recent list, the taskbar jump
/// list, the Dock menu). A path that is not a file is ignored.
#[tauri::command]
pub fn note_recent_document(app: tauri::AppHandle, path: String) {
    if !std::path::Path::new(&path).is_file() {
        return;
    }
    #[cfg(target_os = "linux")]
    let _ = app.run_on_main_thread(move || {
        use gtk::prelude::*;
        let uri = gtk::gio::File::for_path(&path).uri();
        if let Some(manager) = gtk::RecentManager::default() {
            manager.add_item(uri.as_str());
        }
    });
    #[cfg(windows)]
    {
        let _ = &app;
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        // SHARD_PATHW
        unsafe { windows_sys::Win32::UI::Shell::SHAddToRecentDocs(3, wide.as_ptr().cast()) };
    }
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || {
        let Some(mtm) = objc2::MainThreadMarker::new() else { return };
        let url = objc2_foundation::NSURL::fileURLWithPath(&objc2_foundation::NSString::from_str(&path));
        objc2_app_kit::NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
    });
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    let _ = (app, path);
}
