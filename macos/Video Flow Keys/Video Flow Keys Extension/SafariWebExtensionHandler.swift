//
//  SafariWebExtensionHandler.swift
//  Video Flow Keys Extension
//
//  Created by Tristan Drummond on 2026/06/08.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private static let service = TypeSafeService(store: TypeSafeKeychain(), transport: TypeSafeURLTransport())
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let messageKey: String
        if #available(macOS 11.0, *) { messageKey = SFExtensionMessageKey }
        else { messageKey = "message" }
        Self.service.handle(request?.userInfo?[messageKey]) { result in
            let response = NSExtensionItem()
            response.userInfo = [messageKey: result]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

}
