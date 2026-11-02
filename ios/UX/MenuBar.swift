import UIKit

/// The system menu bar of the app (iPadOS 26 shows it from the top edge, and hardware keyboards get the shortcut
/// overlay from it). The interface owns the commands: it sends the whole tree (labels already translated, shortcut,
/// enabled and ticked state) and this file builds UIMenu elements from it. A chosen item goes back as `command`.
///
/// Page to native, message type `menu`:
///   { kind: "tree", rev: Int, menus: [ { id, label, items: [Item] } ] }
///   { kind: "text", focused: Bool }            a text field has focus
/// Item is one of:
///   { sep: true }
///   { label, items: [Item] }                   a submenu
///   { id, label, enabled, checked?, key?: { name, mods } }   a command; name is a letter, digit, punctuation mark,
///                                              "Up" "Down" "Left" "Right" "Escape" "Backspace" "Delete" "Enter" or "F1" to "F12";
///                                              mods holds "command", "shift", "alt"
/// Native to page: `command` { id, source: "native" } and `menuReady` { rev } after each rebuild.
final class MenuBar {
    static let shared = MenuBar()

    private var menus: [[String: Any]] = []
    private var revision = 0
    private var textFocused = false

    /// System menus the interface's own menus take over. The title the person sees is the system's own, localized.
    private static let systemMenus: [String: UIMenu.Identifier] = [
        "File": .file,
        "Edit": .edit,
        "View": .view,
        "Help": .help
    ]
    private static let idPrefix = "ai.nodemode.formmorpheus.menu."

    private init() {}

    /// Called once from UXModule.register(): hooks the menu builder and the bridge.
    func install() {
        AppDelegate.buildMenuHook = { builder in
            MenuBar.shared.build(with: builder)
        }
        Bridge.shared.on("menu") { payload in
            MenuBar.shared.receive(payload)
        }
    }

    // MARK: From the page

    private func receive(_ payload: [String: Any]) {
        let kind = payload["kind"] as? String ?? "tree"
        if kind == "text" {
            textFocused = payload["focused"] as? Bool ?? false
            return
        }
        guard let list = payload["menus"] as? [[String: Any]] else { return }
        menus = list
        revision = (payload["rev"] as? Int) ?? (revision + 1)
        UIMenuSystem.main.setNeedsRebuild()
    }

    // MARK: Building

    /// Called by AppDelegate.buildMenu(with:) through the hook. Does nothing until the page has sent a tree.
    func build(with builder: UIMenuBuilder) {
        guard builder.system == UIMenuSystem.main, !menus.isEmpty else { return }
        // Text styling has no use in an animation studio.
        builder.remove(menu: .format)

        var previous: UIMenu.Identifier = .edit
        for top in menus {
            let id = top["id"] as? String ?? ""
            let title = top["label"] as? String ?? id
            let children = elements(top["items"])
            if children.isEmpty { continue }
            if let system = MenuBar.systemMenus[id], builder.menu(for: system) != nil {
                builder.replaceChildren(ofMenu: system) { _ in children }
                previous = system
            } else {
                let identifier = UIMenu.Identifier(MenuBar.idPrefix + id.lowercased())
                let menu = UIMenu(title: title, identifier: identifier, options: [], children: children)
                builder.insertSibling(menu, afterMenu: previous)
                previous = identifier
            }
        }
        Bridge.shared.send("menuReady", ["rev": revision])
    }

    /// Menu elements for a list of items; separators split it into inline groups.
    private func elements(_ raw: Any?) -> [UIMenuElement] {
        guard let items = raw as? [[String: Any]] else { return [] }
        var groups: [[UIMenuElement]] = [[]]
        for item in items {
            if item["sep"] as? Bool == true {
                if let last = groups.last, !last.isEmpty { groups.append([]) }
                continue
            }
            if let sub = item["items"] as? [[String: Any]] {
                let inner = elements(sub)
                if !inner.isEmpty {
                    let title = item["label"] as? String ?? ""
                    groups[groups.count - 1].append(UIMenu(title: title, children: inner))
                }
                continue
            }
            if let command = command(item) {
                groups[groups.count - 1].append(command)
            }
        }
        let filled = groups.filter { !$0.isEmpty }
        if filled.count <= 1 { return filled.first ?? [] }
        return filled.map { UIMenu(title: "", options: .displayInline, children: $0) }
    }

    private func command(_ item: [String: Any]) -> UICommand? {
        guard let id = item["id"] as? String, let title = item["label"] as? String else { return nil }
        let enabled = item["enabled"] as? Bool ?? true
        let checked = item["checked"] as? Bool ?? false
        let attributes: UIMenuElement.Attributes = enabled ? [] : [.disabled]
        let state: UIMenuElement.State = checked ? .on : .off
        let action = NSSelectorFromString("fmMenuCommand:")
        if let key = item["key"] as? [String: Any],
           let name = key["name"] as? String,
           let input = MenuBar.input(forKey: name) {
            let flags = MenuBar.modifiers(key["mods"] as? [String] ?? [])
            return UIKeyCommand(
                title: title,
                action: action,
                input: input,
                modifierFlags: flags,
                propertyList: id,
                attributes: attributes,
                state: state
            )
        }
        return UICommand(
            title: title,
            action: action,
            propertyList: id,
            attributes: attributes,
            state: state
        )
    }

    private static func modifiers(_ names: [String]) -> UIKeyModifierFlags {
        var flags: UIKeyModifierFlags = []
        if names.contains("command") { flags.insert(.command) }
        if names.contains("shift") { flags.insert(.shift) }
        if names.contains("alt") { flags.insert(.alternate) }
        return flags
    }

    /// The UIKeyCommand input string for the page's key name; nil leaves the item without a shortcut.
    private static func input(forKey name: String) -> String? {
        switch name {
        case "Up": return UIKeyCommand.inputUpArrow
        case "Down": return UIKeyCommand.inputDownArrow
        case "Left": return UIKeyCommand.inputLeftArrow
        case "Right": return UIKeyCommand.inputRightArrow
        case "Escape": return UIKeyCommand.inputEscape
        case "Backspace", "Delete": return UIKeyCommand.inputDelete
        case "Enter": return "\r"
        case "F1": return UIKeyCommand.inputF1
        case "F2": return UIKeyCommand.inputF2
        case "F3": return UIKeyCommand.inputF3
        case "F4": return UIKeyCommand.inputF4
        case "F5": return UIKeyCommand.inputF5
        case "F6": return UIKeyCommand.inputF6
        case "F7": return UIKeyCommand.inputF7
        case "F8": return UIKeyCommand.inputF8
        case "F9": return UIKeyCommand.inputF9
        case "F10": return UIKeyCommand.inputF10
        case "F11": return UIKeyCommand.inputF11
        case "F12": return UIKeyCommand.inputF12
        default:
            // one letter, digit or punctuation mark; letters are lowercase, Shift travels as a modifier
            if name.count == 1 { return name.lowercased() }
            return nil
        }
    }

    // MARK: From the system

    /// A menu item was chosen or its key pressed (the system gives the same call for both). The page replays a pressed
    /// key as a keydown for the commands that own one, so Draw & Paint and dialogs see it as they always did.
    fileprivate func perform(_ id: String) {
        // With a text field focused the standard edit action goes to the field itself (a paste into a field is the
        // system's own, which a page script cannot do without a tap on its own).
        if textFocused, let selector = MenuBar.textActions[id] {
            UIApplication.shared.sendAction(selector, to: nil, from: nil, for: nil)
            return
        }
        Bridge.shared.send("command", ["id": id, "source": "native"])
    }

    private static let textActions: [String: Selector] = [
        "cut": #selector(UIResponderStandardEditActions.cut(_:)),
        "copy": #selector(UIResponderStandardEditActions.copy(_:)),
        "paste": #selector(UIResponderStandardEditActions.paste(_:)),
        "select-all": #selector(UIResponderStandardEditActions.selectAll(_:))
    ]
}

extension UIResponder {
    /// The action of every command in the menu bar. It lives on UIResponder so any first responder, including the
    /// web view, answers it; the command's property list carries the page's command id.
    @objc func fmMenuCommand(_ sender: Any?) {
        guard let command = sender as? UICommand, let id = command.propertyList as? String else { return }
        MenuBar.shared.perform(id)
    }
}
