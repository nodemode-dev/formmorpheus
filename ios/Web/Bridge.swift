import Foundation
import UIKit
import WebKit

/// Two-way channel between Swift and the interface.
/// Page to native: `window.webkit.messageHandlers.fm.postMessage({type, payload})`.
/// Native to page: `Bridge.shared.send(type, payload)` calls `window.__fmNative.receive(...)`.
/// The WKScriptMessageHandler conformance is declared in an extension at the end of this file on purpose: WebKit's
/// protocol is main-actor isolated, and a conformance in the primary declaration would make the whole class
/// main-actor isolated, which breaks send(_:_:) and on(_:_:) calls from the engine, the export code and
/// background queues.
final class Bridge: NSObject {
    static let shared = Bridge()

    /// The web view of the scene that is currently active. Weak so the bridge never keeps it alive.
    weak var webView: WKWebView?

    /// Name of the message handler the page posts to: window.webkit.messageHandlers.fm
    static let handlerName = "fm"

    private var handlers: [String: [([String: Any]) -> Void]] = [:]

    private override init() {
        super.init()
    }

    /// Native to page. Safe to call from any thread; the script runs on the main thread.
    func send(_ type: String, _ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload) else {
            NSLog("Bridge.send: payload for '%@' is not valid JSON, dropped", type)
            return
        }
        let message: [String: Any] = ["type": type, "payload": payload]
        guard JSONSerialization.isValidJSONObject(message),
              let data = try? JSONSerialization.data(withJSONObject: message, options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        // The JSON text is a valid JavaScript object literal, so it is passed as an object, not a string.
        let script = "window.__fmNative && window.__fmNative.receive(" + json + ");"
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                self?.webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }

    /// Page to native. Register one or more handlers per message type; all run on the main thread.
    func on(_ type: String, _ handler: @escaping ([String: Any]) -> Void) {
        let register = { [weak self] in
            guard let self = self else { return }
            var list = self.handlers[type] ?? []
            list.append(handler)
            self.handlers[type] = list
        }
        if Thread.isMainThread {
            register()
        } else {
            DispatchQueue.main.async(execute: register)
        }
    }

    /// Adds the bridge to a web view configuration. The controller holds only a weak proxy.
    @MainActor
    func attach(to controller: WKUserContentController) {
        controller.add(WeakScriptMessageHandler(self), name: Bridge.handlerName)
    }

    // The requirement of WKScriptMessageHandler (conformance in the extension below).
    @MainActor
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else {
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        guard let list = handlers[type] else { return }
        for handler in list {
            handler(payload)
        }
    }
}

extension Bridge: WKScriptMessageHandler {}

/// WKUserContentController retains its message handlers strongly. This proxy holds the real
/// handler weakly so the web view and the handler can never form a retain cycle.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
