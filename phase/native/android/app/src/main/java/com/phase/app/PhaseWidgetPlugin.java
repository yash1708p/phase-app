package com.phase.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Receives the widget snapshot from the web app (see src/lib/widgetBridge.ts). */
@CapacitorPlugin(name = "PhaseWidget")
public class PhaseWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Missing json");
            return;
        }
        PhaseWidgetProvider.saveSnapshot(getContext(), json);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        PhaseWidgetProvider.saveSnapshot(getContext(), null);
        call.resolve();
    }
}
