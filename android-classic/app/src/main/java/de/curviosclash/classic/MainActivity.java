package de.curviosclash.classic;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String ANDROID_BACK_SCRIPT =
        "(function(){try{"
            + "if(window.__curviosAndroidBackHandler&&window.__curviosAndroidBackHandler()){return true;}"
            + "window.dispatchEvent(new CustomEvent('curvios:android-back'));"
            + "return false;"
            + "}catch(e){return false;}})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Gameplay can have long tilt/controller stretches without screen taps.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchBackToWebView(this);
            }
        });
    }

    private void dispatchBackToWebView(OnBackPressedCallback callback) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            runDefaultBack(callback);
            return;
        }
        webView.evaluateJavascript(ANDROID_BACK_SCRIPT, handled -> {
            if (!"true".equals(handled)) {
                runDefaultBack(callback);
            }
        });
    }

    private void runDefaultBack(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
    }
}
