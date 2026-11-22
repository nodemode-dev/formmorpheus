import UIKit

/// State restoration, one record per scene: which Library movie the window shows. The interface reports it (`movie`
/// message: { name, id, title }); the scene delegate returns it from stateRestorationActivity(for:) and hands it back at
/// the next connect, where it becomes an `openURL` { kind: "restore", name } message the page opens when its window is
/// still empty. The movie itself is saved by the interface as it is edited, so nothing else needs to be restored.
///
/// The message does not say which window sent it, so the report belongs to the window the bridge is talking to (the
/// active scene's web view). A window in the background keeps its last report.
final class SceneState {
    static let shared = SceneState()

    /// Activity type of the user activity kept for each scene.
    static let activityType = "ai.nodemode.formmorpheus.activity.movie"

    private struct Record {
        var name: String?
        var id: String?
        var title: String?
    }

    private var records: [String: Record] = [:]

    private init() {}

    func install() {
        Bridge.shared.on("movie") { payload in
            SceneState.shared.receive(payload)
        }
    }

    private func receive(_ payload: [String: Any]) {
        guard let scene = Bridge.shared.webView?.window?.windowScene else { return }
        let record = Record(
            name: payload["name"] as? String,
            id: payload["id"] as? String,
            title: payload["title"] as? String
        )
        records[scene.session.persistentIdentifier] = record
        // The window's title shows in the window switcher and in Stage Manager.
        let title = record.title ?? ""
        scene.title = title.isEmpty ? "FormMorpheus" : title
    }

    // MARK: Called by the scene delegate

    /// The activity the system keeps for this scene and returns at the next connect; nil when no movie is open.
    func activity(for scene: UIScene) -> NSUserActivity? {
        guard let record = records[scene.session.persistentIdentifier],
              let name = record.name, !name.isEmpty else { return nil }
        let activity = NSUserActivity(activityType: SceneState.activityType)
        activity.title = record.title ?? name
        var info: [String: Any] = ["name": name]
        if let id = record.id { info["id"] = id }
        activity.userInfo = info
        return activity
    }

    /// Called from scene(_:willConnectTo:options:). `send` delivers a bridge message to the scene's page when it has
    /// loaded. A file the launch itself opened wins over the restored movie.
    func restore(
        from session: UISceneSession,
        options: UIScene.ConnectionOptions,
        send: @escaping (String, [String: Any]) -> Void
    ) {
        guard options.urlContexts.isEmpty,
              let activity = session.stateRestorationActivity,
              activity.activityType == SceneState.activityType,
              let name = activity.userInfo?["name"] as? String, !name.isEmpty else { return }
        send("openURL", ["kind": "restore", "name": name])
    }
}
