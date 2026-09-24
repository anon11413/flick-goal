package com.flickgoal.game;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Flick Goal: the Capacitor WebView activity, full screen (immersive "sticky").
 *
 * The status and navigation bars are hidden while the game has focus. A swipe from the edge shows
 * them for a moment and they hide again on their own (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE), so the
 * one-tap game never loses screen space. They are re-hidden whenever the window regains focus (after
 * a full-screen ad, the Google Play purchase sheet, the consent form, or returning from another app).
 * Safe-area insets (camera cutouts) still reach the page as CSS env() / --safe-area-inset-* values
 * through Capacitor's SystemBars plugin (capacitor.config.json).
 *
 * The hardware / gesture Back button is handled in JavaScript (src/platform/nativeShell.js via the
 * @capacitor/app "backButton" event), which replaces the default "go back / close the app".
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        Window window = getWindow();
        if (window == null) {
            return;
        }
        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
