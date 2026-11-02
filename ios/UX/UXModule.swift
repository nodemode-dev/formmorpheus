import Foundation

/// The UX builder's one entry point. AppModules.registerAll() calls register() at launch (main thread, before the
/// first window), and the scene delegate calls DocumentOpening and SceneState (see ios/HASHOUT_LOG.md for the call sites).
enum UXModule {
    static func register() {
        MenuBar.shared.install()
        SceneState.shared.install()
        DocumentOpening.cleanInbox()
    }
}
