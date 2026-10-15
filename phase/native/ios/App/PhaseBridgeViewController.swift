import UIKit
import Capacitor

/// Registers Phase's local native plugin. Add this file to the **App** target, then in
/// SceneDelegate.swift replace `CAPBridgeViewController()` with `PhaseBridgeViewController()`.
class PhaseBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhaseWidgetPlugin())
    }
}
