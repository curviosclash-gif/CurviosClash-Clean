package de.curviosclash.classic;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.view.WindowManager;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.stream.Collectors;

@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    private static final String APP_ID = "de.curviosclash.classic";

    @Test
    public void packagedAppMatchesTheMobileClassicProductContract() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageManager packageManager = appContext.getPackageManager();

        assertEquals(APP_ID, appContext.getPackageName());

        Intent launchIntent = packageManager.getLaunchIntentForPackage(APP_ID);
        assertNotNull(launchIntent);
        ComponentName launchComponent = launchIntent.getComponent();
        assertNotNull(launchComponent);
        assertEquals(APP_ID, launchComponent.getPackageName());
        assertEquals(MainActivity.class.getName(), launchComponent.getClassName());

        ActivityInfo activityInfo = packageManager.getActivityInfo(launchComponent, 0);
        assertTrue(activityInfo.exported);
        assertEquals(
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
            activityInfo.screenOrientation
        );

        String indexHtml = readAsset(appContext, "public/index.html");
        assertTrue(indexHtml.contains("<title>Curvios Clash</title>"));
        assertTrue(indexHtml.contains("id=\"game-container\""));

        JSONObject manifest = new JSONObject(readAsset(
            appContext,
            "public/mobile-classic.manifest.json"
        ));
        assertEquals("curvios.mobile-android-app.v1", manifest.getString("contract"));
        assertEquals(APP_ID, manifest.getJSONObject("app").getString("id"));
        assertEquals("mobile-classic", manifest.getJSONObject("app").getString("target"));

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertTrue(activity instanceof BridgeActivity);
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertTrue((activity.getWindow().getAttributes().flags
                    & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0);
            });
        }
    }

    private static String readAsset(Context context, String assetPath) throws Exception {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
            context.getAssets().open(assetPath),
            StandardCharsets.UTF_8
        ))) {
            return reader.lines().collect(Collectors.joining("\n"));
        }
    }
}
