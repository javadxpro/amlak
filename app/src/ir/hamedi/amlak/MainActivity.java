package ir.hamedi.amlak;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.Manifest;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {

    private WebView webView;
    private static final int REQ_WRITE = 1001;
    private String pendingJson = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setAllowContentAccess(true);
        ws.setDatabaseEnabled(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            ws.setMediaPlaybackRequiresUserGesture(false);
        }

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // keep navigation inside WebView for file://, but open tel: and external http in system?
                if (url.startsWith("tel:") || url.startsWith("mailto:") || url.startsWith("https://wa.me")) {
                    try {
                        android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(i);
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }
                return false;
            }
        });

        webView.addJavascriptInterface(new JsBridge(), "Android");

        // Load local asset
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WRITE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                if (pendingJson != null) {
                    doExportOld(pendingJson);
                    pendingJson = null;
                }
            } else {
                Toast.makeText(this, "مجوز نوشتن فایل رد شد", Toast.LENGTH_LONG).show();
                evaluateJs("onExportResult(false, 'مجوز رد شد')");
            }
        }
    }

    private void evaluateJs(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    webView.evaluateJavascript(js, null);
                } else {
                    webView.loadUrl("javascript:" + js);
                }
            }
        });
    }

    private void doExportNewApi(String json) {
        try {
            ContentResolver resolver = getContentResolver();
            Uri collection;
            // For Android 10+ we use MediaStore.Files with RELATIVE_PATH Documents
            // Try MediaStore.Downloads first? But spec says Documents, so use Files.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                collection = MediaStore.Files.getContentUri("external");
            } else {
                collection = MediaStore.Files.getContentUri("external");
            }

            // Delete existing file if present in Documents (query by DISPLAY_NAME)
            // For older query that may not have RELATIVE_PATH, fallback
            try {
                Cursor c = resolver.query(collection, new String[]{MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH},
                        MediaStore.MediaColumns.DISPLAY_NAME + "=?", new String[]{"properties.json"}, null);
                if (c != null) {
                    while (c.moveToNext()) {
                        long id = c.getLong(0);
                        // Optionally check path contains Documents
                        Uri uri = Uri.withAppendedPath(collection, String.valueOf(id));
                        try {
                            resolver.delete(uri, null, null);
                        } catch (Exception ignore) {}
                    }
                    c.close();
                }
            } catch (Exception ignore) {
                // ignore query failure, continue to insert
            }

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, "properties.json");
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Documents");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            }

            Uri fileUri = resolver.insert(collection, values);
            if (fileUri == null) {
                // fallback to Downloads collection
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    collection = MediaStore.Downloads.getContentUri("external");
                    values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, "properties.json");
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Documents");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    fileUri = resolver.insert(collection, values);
                }
            }

            if (fileUri == null) {
                throw new Exception("MediaStore insert failed");
            }

            OutputStream os = resolver.openOutputStream(fileUri);
            if (os == null) throw new Exception("openOutputStream null");
            os.write(json.getBytes("UTF-8"));
            os.flush();
            os.close();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues pending = new ContentValues();
                pending.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(fileUri, pending, null, null);
            }

            Toast.makeText(this, "فایل در Documents/properties.json ذخیره شد", Toast.LENGTH_LONG).show();
            evaluateJs("onExportResult(true, 'ذخیره شد: /storage/emulated/0/Documents/properties.json')");
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "خطا در ذخیره: " + e.getMessage(), Toast.LENGTH_LONG).show();
            evaluateJs("onExportResult(false, 'خطا: " + e.getMessage().replace("'", "") + "')");
        }
    }

    private void doExportOld(String json) {
        try {
            File docs = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            if (!docs.exists()) {
                boolean ok = docs.mkdirs();
                if (!ok) {
                    // try /storage/emulated/0/Documents manually
                    docs = new File("/storage/emulated/0/Documents");
                    docs.mkdirs();
                }
            }
            File file = new File(docs, "properties.json");
            FileOutputStream fos = new FileOutputStream(file);
            fos.write(json.getBytes("UTF-8"));
            fos.flush();
            fos.close();
            Toast.makeText(this, "فایل ذخیره شد: " + file.getAbsolutePath(), Toast.LENGTH_LONG).show();
            evaluateJs("onExportResult(true, 'ذخیره شد: " + file.getAbsolutePath() + "')");
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "خطا در ذخیره: " + e.getMessage(), Toast.LENGTH_LONG).show();
            evaluateJs("onExportResult(false, 'خطا: " + e.getMessage().replace("'", "") + "')");
        }
    }

    public class JsBridge {

        @JavascriptInterface
        public void exportJson(String json) {
            // Called from JS thread, need to handle on UI
            final String data = json;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        // Android 10+ MediaStore
                        doExportNewApi(data);
                    } else {
                        // Check permission
                        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                            pendingJson = data;
                            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_WRITE);
                        } else {
                            doExportOld(data);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void showToast(String msg) {
            final String m = msg;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public int getSdkInt() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public String getExportPath() {
            return "/storage/emulated/0/Documents/properties.json";
        }

        @JavascriptInterface
        public void log(String s) {
            android.util.Log.d("Amlak", s);
        }
    }
}
