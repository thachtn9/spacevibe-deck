import Foundation
import Security

enum ConnectionVault {
    private static let identity: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.spacevibe.deck.remote",
        kSecAttrAccount as String: "paired-computer"
    ]

    static func load() -> RemoteConnection? {
        var query = identity
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(RemoteConnection.self, from: data)
    }

    static func save(_ connection: RemoteConnection) throws {
        let data = try JSONEncoder().encode(connection)
        let values: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(identity as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(identity.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw RemoteError.message("The pairing key could not be saved in Keychain.") }
    }

    static func remove() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw RemoteError.message("The pairing key could not be removed from Keychain.")
        }
    }
}
