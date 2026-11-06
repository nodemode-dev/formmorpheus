import UIKit
import WebKit

/// Hosts the interface in a WKWebView and loads it from fm://localhost/index.html.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let startURL = URL(string: "fm://localhost/index.html")!

    private(set) var webView: WKWebView!
    private var recoveredAfterTermination = false
    private var pageLoaded = false
    private var pendingSends: [(type: String, payload: [String: Any])] = []

    // MARK: Life cycle

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(FMSchemeHandler(), forURLScheme: FMSchemeHandler.scheme)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = configuration.userContentController
        controller.addUserScript(
            WKUserScript(
                source: WebViewController.documentStartScript(),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        Bridge.shared.attach(to: controller)

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        web.isOpaque = true
        web.backgroundColor = WebViewController.groundColor
        web.scrollView.backgroundColor = WebViewController.groundColor
        web.scrollView.bounces = false
        web.scrollView.alwaysBounceVertical = false
        web.scrollView.alwaysBounceHorizontal = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.keyboardDismissMode = .none
        #if DEBUG
        web.isInspectable = true
        #endif

        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        Bridge.shared.webView = webView
        PencilController.shared.attach(to: webView)
        webView.load(URLRequest(url: WebViewController.startURL))
    }

    /// Called by the scene when it becomes active so the bridge talks to this window's web view.
    func makeActive() {
        Bridge.shared.webView = webView
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == FMSchemeHandler.scheme || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        // Web addresses and mail links open outside the app.
        if scheme == "http" || scheme == "https" || scheme == "mailto" {
            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The page buffers native messages until its listener exists (see the start script).
        if recoveredAfterTermination {
            recoveredAfterTermination = false
            Bridge.shared.send("contentProcessRecovered", [:])
        }
        pageLoaded = true
        if !pendingSends.isEmpty {
            makeActive()
            for item in pendingSends {
                Bridge.shared.send(item.type, item.payload)
            }
            pendingSends.removeAll()
        }
    }

    /// Sends a native message now if the page has loaded, else right after it loads
    /// (for example the file a launch opened).
    func sendWhenLoaded(_ type: String, _ payload: [String: Any]) {
        if pageLoaded {
            makeActive()
            Bridge.shared.send(type, payload)
        } else {
            pendingSends.append((type: type, payload: payload))
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        NSLog("Web content process terminated, reloading")
        recoveredAfterTermination = true
        pageLoaded = false
        webView.load(URLRequest(url: WebViewController.startURL))
    }

    // MARK: WKUIDelegate

    // Links that ask for a new window (target=_blank) open outside the app.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "http" || scheme == "https" || scheme == "mailto" {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // MARK: Appearance and page scripts

    /// Same value as --bg-primary in frontend/src/styles/tokens.css, shown before the page paints.
    private static let groundColor = UIColor(red: 17.0 / 255.0, green: 17.0 / 255.0, blue: 17.0 / 255.0, alpha: 1.0)

    /// Runs before the page's own scripts. Defines the platform record and the native channel.
    /// __fmNative.receive(msg) takes an object or a JSON string. Messages that arrive before any
    /// listener exists are kept and replayed when the first listener is added with on() or addListener().
    private static func documentStartScript() -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        let appVersion = info["CFBundleShortVersionString"] as? String ?? "0"
        let build = info["CFBundleVersion"] as? String ?? "0"
        let os = UIDevice.current.systemVersion
        let platform: [String: Any] = ["kind": "ipad", "appVersion": appVersion, "build": build, "os": os]
        var platformJSON = "{}"
        if let data = try? JSONSerialization.data(withJSONObject: platform, options: []),
           let text = String(data: data, encoding: .utf8) {
            platformJSON = text
        }
        return """
        (function () {
          window.__FM_PLATFORM__ = \(platformJSON);
          var listeners = [];
          var queue = [];
          var replaced = false;
          function dispatch(msg) {
            for (var i = 0; i < listeners.length; i++) {
              try { listeners[i](msg); } catch (e) { console.error('fm native listener', e); }
            }
          }
          function addListener(fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            var pending = queue;
            queue = [];
            for (var i = 0; i < pending.length; i++) dispatch(pending[i]);
            return function () {
              var at = listeners.indexOf(fn);
              if (at >= 0) listeners.splice(at, 1);
            };
          }
          var impl = function (json) {
            var msg = json;
            if (typeof json === 'string') {
              try { msg = JSON.parse(json); } catch (e) { return; }
            }
            if (!msg) return;
            if (listeners.length > 0) { dispatch(msg); return; }
            if (!replaced) { queue.push(msg); if (queue.length > 200) queue.shift(); }
          };
          var native = {
            on: addListener,
            addListener: addListener,
            post: function (type, payload) {
              window.webkit.messageHandlers.fm.postMessage({ type: type, payload: payload || {} });
            }
          };
          // The page replaces receive with its own function (usually wrapping this one). When it does,
          // the messages that arrived earlier are handed to the new function once.
          Object.defineProperty(native, 'receive', {
            enumerable: true,
            configurable: true,
            get: function () { return impl; },
            set: function (fn) {
              if (typeof fn !== 'function') return;
              var pending = queue;
              queue = [];
              replaced = true;
              impl = fn;
              for (var i = 0; i < pending.length; i++) {
                try { fn(pending[i]); } catch (e) { console.error('fm native replay', e); }
              }
            }
          });
          window.__fmNative = native;
        })();
        """
    }
}
