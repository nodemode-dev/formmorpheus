// VoiceKeychain.swift
// The AI Voice keys on iPad: one generic password per account in the Keychain, under the service name the desktop's
// keyring uses (FormMorpheus). Kept on this device only, readable after the first unlock, never in UserDefaults.

import Foundation
import Security

enum VoiceKeychain {
    static let service = "FormMorpheus"

    private static func query(_ account: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func get(_ account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef? = nil
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data,
              let text = String(data: data, encoding: .utf8), !text.isEmpty else { return nil }
        return text
    }

    /// False when the Keychain refused the key.
    static func set(_ account: String, _ value: String) -> Bool {
        let data = Data(value.utf8)
        let changes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(query(account) as CFDictionary, changes as CFDictionary)
        if updated == errSecSuccess { return true }
        if updated != errSecItemNotFound { _ = SecItemDelete(query(account) as CFDictionary) }
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func delete(_ account: String) {
        _ = SecItemDelete(query(account) as CFDictionary)
    }
}
