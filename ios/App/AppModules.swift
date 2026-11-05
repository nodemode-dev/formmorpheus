import Foundation

/// The one place where each builder's native module is wired in at launch.
/// A module exposes something like `enum PencilModule { static func register() }` that calls
/// Bridge.shared.on(...) for its message types, then adds one line here.
/// Keep every call cheap: this runs on the main thread before the first window appears.
enum AppModules {
    static func registerAll() {
        // Diagnostics is registered by AppDelegate. The Pencil attaches itself in WebViewController.
        FileBridge.register()
        // Add module registrations below, one per line, for example:
        // PencilModule.register()
        // ExportModule.register()
        MemoryModule.register()
        UXModule.register()
    }
}
