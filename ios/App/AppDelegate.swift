import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    /// The UX builder sets this (from AppModules.registerAll) to add the menu bar commands.
    nonisolated(unsafe) static var buildMenuHook: ((UIMenuBuilder) -> Void)?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Diagnostics.register()
        AppModules.registerAll()
        return true
    }

    // Scenes are configured in Info.plist (UIApplicationSceneManifest), so no
    // configurationForConnecting method is needed here.

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        AppDelegate.buildMenuHook?(builder)
    }
}
