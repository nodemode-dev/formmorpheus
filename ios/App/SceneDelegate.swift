import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private var webController: WebViewController? {
        return window?.rootViewController as? WebViewController
    }

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window

        if !connectionOptions.urlContexts.isEmpty {
            handleOpen(connectionOptions.urlContexts)
        }
        SceneState.shared.restore(from: session, options: connectionOptions, send: sendToPage)
    }

    /// Delivers a native message to this window's page now, or right after it loads.
    private func sendToPage(_ type: String, _ payload: [String: Any]) {
        webController?.sendWhenLoaded(type, payload)
    }

    /// The system keeps this activity per window and hands it back at the next launch (the open movie).
    func stateRestorationActivity(for scene: UIScene) -> NSUserActivity? {
        return SceneState.shared.activity(for: scene)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        webController?.makeActive()
        Bridge.shared.send("appState", ["state": "active", "active": true])
    }

    func sceneWillResignActive(_ scene: UIScene) {
        Bridge.shared.send("appState", ["state": "inactive", "active": false])
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        Bridge.shared.send("appState", ["state": "background", "active": false])
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        handleOpen(URLContexts)
    }

    /// Files opened from Files, AirDrop or another app: DocumentOpening (ios/UX) copies a movie into the Library, or
    /// stages another file for import, and sends `openURL` to this window's page.
    private func handleOpen(_ contexts: Set<UIOpenURLContext>) {
        DocumentOpening.handle(contexts, send: sendToPage)
    }
}
