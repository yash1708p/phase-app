package com.phase.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Phase home-screen widget: Fatigue, Sleep, Water and Stress rings.
 * Medium (4×2 cells) shows four rings in a row; small (2×2) shows a 2×2 grid.
 */
public class PhaseWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "phase_widget";
    static final String KEY = "snapshot";

    // Design tokens — keep in sync with src/components/MetricRings.tsx
    private static final int TRACK = 0x1FFFFFFF;
    private static final int TONE_GOOD = 0xFF7FD1B0;
    private static final int TONE_OK = 0xFFF2B35E;
    private static final int TONE_ALERT = 0xFFF2798A;
    private static final int TONE_NONE = 0x47FFFFFF;

    private static final int[] RING_IDS = {R.id.ring_0, R.id.ring_1, R.id.ring_2, R.id.ring_3};
    private static final int[] VALUE_IDS = {R.id.value_0, R.id.value_1, R.id.value_2, R.id.value_3};
    private static final int[] LABEL_IDS = {R.id.label_0, R.id.label_1, R.id.label_2, R.id.label_3};

    /** Called by PhaseWidgetPlugin whenever the app's data changes. Pass null to clear (log out). */
    static void saveSnapshot(Context ctx, String json) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (json == null) e.remove(KEY);
        else e.putString(KEY, json);
        e.apply();
        refreshAll(ctx);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, PhaseWidgetProvider.class));
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle newOptions) {
        render(ctx, m, id); // switch between small and medium layouts on resize
    }

    private static void render(Context ctx, AppWidgetManager m, int id) {
        Bundle opts = m.getAppWidgetOptions(id);
        boolean small = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) < 200;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), small ? R.layout.phase_widget_small : R.layout.phase_widget_medium);

        // Tap anywhere → open Phase.
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.widget_root, pi);
        }

        String json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        JSONObject snap = null;
        try {
            if (json != null) snap = new JSONObject(json);
        } catch (Exception ignored) {
        }

        if (snap == null) {
            v.setViewVisibility(R.id.metrics, View.GONE);
            v.setViewVisibility(R.id.empty_text, View.VISIBLE);
            v.setTextViewText(R.id.cycle_text, "");
            m.updateAppWidget(id, v);
            return;
        }
        v.setViewVisibility(R.id.metrics, View.VISIBLE);
        v.setViewVisibility(R.id.empty_text, View.GONE);

        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean stale = !today.equals(snap.optString("date"));

        // Optional cycle line (only present if the user turned it on in Settings).
        JSONObject cycle = snap.optJSONObject("cycle");
        String cycleText = small ? "" : "Today";
        if (cycle != null) {
            int day = cycle.optInt("day") + (stale ? daysBetween(snap.optString("date"), today) : 0);
            String phase = cycle.optString("phase").replace(" phase", "");
            cycleText = (stale || small) ? "Day " + day : "Day " + day + " · " + phase;
        }
        v.setTextViewText(R.id.cycle_text, cycleText);

        JSONArray metrics = snap.optJSONArray("metrics");
        float ringDp = small ? 38f : 56f;
        float strokeDp = small ? 4.5f : 6f;
        for (int i = 0; i < 4; i++) {
            JSONObject mtr = metrics != null ? metrics.optJSONObject(i) : null;
            if (mtr == null) continue;
            String tone = stale ? "none" : mtr.optString("tone", "none");
            String value = stale ? "—" : mtr.optString("short", mtr.optString("value", "—"));
            double fill = stale ? 0 : mtr.optDouble("fill", 0);
            String label = mtr.optString("label");
            v.setImageViewBitmap(RING_IDS[i], ring(ctx, fill, toneColor(tone), ringDp, strokeDp, "none".equals(tone)));
            v.setTextViewText(VALUE_IDS[i], value);
            v.setTextViewText(LABEL_IDS[i], small ? label : label.toUpperCase(Locale.ROOT));
            v.setContentDescription(RING_IDS[i], label + ": " + ("—".equals(value) ? "not logged" : value));
        }
        m.updateAppWidget(id, v);
    }

    private static int toneColor(String tone) {
        switch (tone) {
            case "good": return TONE_GOOD;
            case "ok": return TONE_OK;
            case "alert": return TONE_ALERT;
            default: return TONE_NONE;
        }
    }

    private static int daysBetween(String fromIso, String toIso) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            long ms = f.parse(toIso).getTime() - f.parse(fromIso).getTime();
            return (int) Math.round(ms / 86_400_000.0);
        } catch (Exception e) {
            return 0;
        }
    }

    /** Draws one ring gauge as a bitmap (RemoteViews can't draw arcs directly). */
    private static Bitmap ring(Context ctx, double fill, int color, float sizeDp, float strokeDp, boolean dashed) {
        float d = ctx.getResources().getDisplayMetrics().density;
        int px = Math.round(sizeDp * d);
        float sw = strokeDp * d;
        Bitmap bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);
        RectF r = new RectF(sw / 2, sw / 2, px - sw / 2, px - sw / 2);

        if (dashed) {
            p.setStrokeWidth(1.5f * d);
            p.setColor(color);
            p.setPathEffect(new DashPathEffect(new float[] {3 * d, 4 * d}, 0));
            c.drawOval(r, p);
            return bmp;
        }
        p.setStrokeWidth(sw);
        p.setColor(TRACK);
        c.drawOval(r, p);
        if (fill > 0) {
            p.setColor(color);
            c.drawArc(r, -90f, (float) (360 * Math.max(fill, 0.04)), false, p);
        }
        return bmp;
    }
}
