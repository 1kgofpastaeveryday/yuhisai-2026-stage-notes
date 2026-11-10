import Foundation
import Security

enum DeviceIdentity {
    struct Credential { let id: String; let key: String }
    enum Failure: Error { case keychain(OSStatus), invalidValue, random(OSStatus) }
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let service = "<REDACTED>"
    static func validID(_ value: String) -> Bool {
        value.count == 6 && value.allSatisfy { alphabet.contains($0) }
    }
    static func validKey(_ value: String) -> Bool {
        guard value.utf8.count == 43, value.utf8.allSatisfy({
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
        }), let bytes = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), bytes.count == 32 else { return false }
        return encode(bytes) == value
    }
    private static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private static func random(_ count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        guard status == errSecSuccess else { throw Failure.random(status) }
        return Data(bytes)
    }
    static func load() throws -> Credential {
        let id = try loadValue(account: "device-id", accessibility: kSecAttrAccessibleAfterFirstUnlock,
            validate: validID, generate: { String(try random(6).map { alphabet[Int($0) % 32] }) })
        let key = try loadValue(account: "device-key", accessibility: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            validate: validKey, generate: { encode(try random(32)) })
        // Existing installs may have created the key with the ID's backup policy.
        // Tighten that same item without ever replacing its credential.
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "device-key"]
        let status = SecItemUpdate(query as CFDictionary,
            [kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as CFDictionary)
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        return Credential(id: id, key: key)
    }
    private static func loadValue(account: String, accessibility: CFString, validate: (String) -> Bool, generate: () throws -> String) throws -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account]
        func read() -> (OSStatus, String?) {
            var readQuery = query
            readQuery[kSecReturnData as String] = true
            readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(readQuery as CFDictionary, &item)
            return (status, (item as? Data).flatMap { String(data: $0, encoding: .utf8) })
        }
        func checked(_ result: (OSStatus, String?)) throws -> String {
            guard result.0 == errSecSuccess else { throw Failure.keychain(result.0) }
            guard let value = result.1, validate(value) else { throw Failure.invalidValue }
            return value
        }
        let result = read()
        if result.0 != errSecItemNotFound { return try checked(result) }
        let value = try generate()
        var attributes = query
        attributes[kSecAttrAccessible as String] = accessibility
        attributes[kSecValueData as String] = Data(value.utf8)
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem { return try checked(read()) }
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        return value
    }
}

/// The phone's own IPv4 address on Wi-Fi (`en0`), shown so the operator can read it out.
enum LocalNetwork {
    static func wifiIPv4() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }

        var fallback: String?
        for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = entry.pointee
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: ifa.ifa_name)
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count),
                              nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(decoding: host.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
            if name == "en0" { return ip }
            // The simulator has no en0 of its own; fall back to the first non-loopback address.
            if fallback == nil && !ip.hasPrefix("127.") { fallback = ip }
        }
        return fallback
    }
}
