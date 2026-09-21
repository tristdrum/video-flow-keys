import Foundation
import Security

protocol TypeSafeKeyStore {
    func read() throws -> String?
    func save(_ key: String) throws
    func remove() throws
}

/// The provisioned default access group belongs only to this signed extension.
struct TypeSafeKeychain: TypeSafeKeyStore {
    private let service: String

    init(service: String = "com.tristdrum.VideoFlowKeys.typesafe") { self.service = service }

    private var query: [String: Any] {
        var value: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "api-key"
        ]
        if #available(macOS 10.15, *) { value[kSecUseDataProtectionKeychain as String] = true }
        return value
    }

    func read() throws -> String? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let key = String(data: data, encoding: .utf8) else { throw TypeSafeFailure.keyStorage }
        return key
    }

    func save(_ key: String) throws {
        let attributes = [kSecValueData as String: Data(key.utf8)]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query.merging(attributes) { _, new in new }
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw TypeSafeFailure.keyStorage }
        } else if status != errSecSuccess { throw TypeSafeFailure.keyStorage }
    }

    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw TypeSafeFailure.keyStorage }
    }
}
