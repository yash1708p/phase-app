import Foundation
import Capacitor
import WidgetKit

/// Receives the widget snapshot from the web app and shares it with the widget extension.
/// Add this file to the **App** target.
@objc(PhaseWidgetPlugin)
public class PhaseWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhaseWidgetPlugin"
    public let jsName = "PhaseWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    /// Must match the App Group you enable on BOTH the App and PhaseWidget targets.
    static let appGroup = "group.com.phase.app"
    static let key = "snapshot"

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json")
            return
        }
        UserDefaults(suiteName: Self.appGroup)?.set(json, forKey: Self.key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        UserDefaults(suiteName: Self.appGroup)?.removeObject(forKey: Self.key)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
