#!/usr/bin/env bash
set -euo pipefail

# املاک حامدی - اسکریپت ساخت APK بدون Android SDK
# ابزارها از npm (@drxiaozhi/minapk برای android.jar/d8/ecj/apksigner و aaptjs3 برای aapt2)
# جاوا از PyPI (jdk4py)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== املاک حامدی - شروع ساخت APK ==="

# ---------- Java from jdk4py ----------
if ! python3 -c "import jdk4py" 2>/dev/null; then
  echo "نصب jdk4py از PyPI..."
  pip install jdk4py --break-system-packages -q
fi

JAVA_BIN="$(python3 -c "import jdk4py; print(jdk4py.JAVA)")"
JAVA_HOME="$(python3 -c "import jdk4py; print(jdk4py.JAVA_HOME)")"
KEYTOOL_BIN="$JAVA_HOME/bin/keytool"

if [ ! -x "$JAVA_BIN" ]; then
  echo "خطا: java از jdk4py یافت نشد: $JAVA_BIN" >&2
  exit 1
fi

echo "Java: $JAVA_BIN"
echo "Keytool: $KEYTOOL_BIN"
"$JAVA_BIN" -version

# ---------- npm tools ----------
if [ ! -d "node_modules" ]; then
  echo "نصب ابزارهای npm..."
  npm install --silent
fi

MINAPK_TOOLS="$SCRIPT_DIR/node_modules/@drxiaozhi/minapk/tools"
ANDROID_JAR="$MINAPK_TOOLS/android.jar"
D8_JAR="$MINAPK_TOOLS/d8.jar"
ECJ_JAR="$MINAPK_TOOLS/ecj-3.45.0.jar"
APKSIGNER_JAR="$MINAPK_TOOLS/apksigner.jar"

if [ ! -f "$ANDROID_JAR" ]; then
  echo "خطا: android.jar یافت نشد در $MINAPK_TOOLS" >&2
  exit 1
fi

# aapt2 from aaptjs3
AAPT2_BIN="$(node -e "console.log(require('aaptjs3').getBinPath())" 2>/dev/null || true)"
if [ -z "$AAPT2_BIN" ] || [ ! -f "$AAPT2_BIN" ]; then
  # fallback search
  AAPT2_BIN="$(find "$SCRIPT_DIR/node_modules/aaptjs3" -type f -name "aapt2*" | head -n1)"
fi

if [ ! -f "$AAPT2_BIN" ]; then
  echo "خطا: aapt2 یافت نشد" >&2
  exit 1
fi

chmod +x "$AAPT2_BIN" 2>/dev/null || true

echo "android.jar: $ANDROID_JAR"
echo "d8.jar: $D8_JAR"
echo "ecj: $ECJ_JAR"
echo "apksigner: $APKSIGNER_JAR"
echo "aapt2: $AAPT2_BIN"

# ---------- dirs ----------
BUILD_DIR="$SCRIPT_DIR/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/res" "$BUILD_DIR/classes" "$BUILD_DIR/dex" "$BUILD_DIR/apk" "$BUILD_DIR/apk_final"

# ---------- compile resources ----------
echo "[1/7] کامپایل منابع با aapt2..."
if [ -d "$SCRIPT_DIR/res" ] && [ "$(find "$SCRIPT_DIR/res" -type f | wc -l)" -gt 0 ]; then
  "$AAPT2_BIN" compile --dir "$SCRIPT_DIR/res" -o "$BUILD_DIR/res/compiled.zip"
  COMPILED_RES="$BUILD_DIR/res/compiled.zip"
else
  COMPILED_RES=""
fi

echo "[2/7] لینک manifest و assets..."
# assets
ASSETS_DIR="$SCRIPT_DIR/assets"
if [ -d "$ASSETS_DIR" ]; then
  ASSETS_FLAG="-A $ASSETS_DIR"
else
  ASSETS_FLAG=""
fi

if [ -n "$COMPILED_RES" ]; then
  # shellcheck disable=SC2086
  "$AAPT2_BIN" link \
    -o "$BUILD_DIR/apk/resources.apk" \
    -I "$ANDROID_JAR" \
    --manifest "$SCRIPT_DIR/AndroidManifest.xml" \
    --auto-add-overlay \
    $ASSETS_FLAG \
    "$COMPILED_RES"
else
  # shellcheck disable=SC2086
  "$AAPT2_BIN" link \
    -o "$BUILD_DIR/apk/resources.apk" \
    -I "$ANDROID_JAR" \
    --manifest "$SCRIPT_DIR/AndroidManifest.xml" \
    $ASSETS_FLAG
fi

# ---------- compile Java ----------
echo "[3/7] کامپایل جاوا با ecj..."
JAVA_SRC="$(find "$SCRIPT_DIR/src" -name "*.java")"
if [ -z "$JAVA_SRC" ]; then
  echo "خطا: فایل جاوا یافت نشد" >&2
  exit 1
fi

# shellcheck disable=SC2086
"$JAVA_BIN" -jar "$ECJ_JAR" \
  -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD_DIR/classes" \
  $JAVA_SRC

echo "کلاس‌های کامپایل شده:"
find "$BUILD_DIR/classes" -name "*.class"

# ---------- dex with d8 ----------
echo "[4/7] تبدیل به dex با d8..."
find "$BUILD_DIR/classes" -name "*.class" > "$BUILD_DIR/classes.list"
# Use D8 directly (more reliable than R8 without proguard config)
"$JAVA_BIN" -cp "$D8_JAR" com.android.tools.r8.D8 \
  --release \
  --min-api 21 \
  --lib "$ANDROID_JAR" \
  --output "$BUILD_DIR/dex" \
  @"$BUILD_DIR/classes.list"

ls -lh "$BUILD_DIR/dex"

# fallback if classes.dex not found, try without @
if [ ! -f "$BUILD_DIR/dex/classes.dex" ]; then
  echo "تلاش مجدد بدون @..."
  "$JAVA_BIN" -cp "$D8_JAR" com.android.tools.r8.D8 \
    --release \
    --min-api 21 \
    --lib "$ANDROID_JAR" \
    --output "$BUILD_DIR/dex" \
    $(cat "$BUILD_DIR/classes.list")
fi

ls -lh "$BUILD_DIR/dex"

# ---------- package + zipalign via apkpack.js ----------
echo "[5/7] بسته‌بندی و هم‌ترازی ZIP با apkpack.js..."
UNSIGNED_APK="$BUILD_DIR/apk_final/app-unsigned.apk"
ALIGNED_APK="$BUILD_DIR/apk_final/app-aligned.apk"

node "$SCRIPT_DIR/apkpack.js" pack \
  --input "$BUILD_DIR/apk/resources.apk" \
  --dex "$BUILD_DIR/dex/classes.dex" \
  --output "$UNSIGNED_APK"

node "$SCRIPT_DIR/apkpack.js" align \
  --input "$UNSIGNED_APK" \
  --output "$ALIGNED_APK"

ls -lh "$BUILD_DIR/apk_final/"

# ---------- keystore ----------
echo "[6/7] بررسی keystore..."
KEYSTORE_DIR="$SCRIPT_DIR/keystore"
mkdir -p "$KEYSTORE_DIR"
KEYSTORE_FILE="$KEYSTORE_DIR/amlak.keystore"
KEY_ALIAS="amlak"
KEY_PASS="amlak123"
STORE_PASS="amlak123"

if [ ! -f "$KEYSTORE_FILE" ]; then
  echo "ساخت keystore جدید در $KEYSTORE_FILE..."
  "$KEYTOOL_BIN" -genkeypair \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -sigalg SHA256withRSA \
    -validity 10000 \
    -keystore "$KEYSTORE_FILE" \
    -storetype JKS \
    -storepass "$STORE_PASS" \
    -keypass "$KEY_PASS" \
    -dname "CN=املاک حامدی, OU=Amlak, O=Hamedi, L=Shoosh, S=Khuzestan, C=IR"
  echo "keystore ساخته شد"
else
  echo "keystore موجود است: $KEYSTORE_FILE"
fi

# ---------- sign ----------
echo "[7/7] امضای APK..."
RELEASE_DIR="$SCRIPT_DIR/release"
mkdir -p "$RELEASE_DIR"
FINAL_APK="$RELEASE_DIR/amlak-hamedi.apk"

"$JAVA_BIN" -jar "$APKSIGNER_JAR" sign \
  --ks "$KEYSTORE_FILE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass pass:"$STORE_PASS" \
  --key-pass pass:"$KEY_PASS" \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled false \
  --v4-signing-enabled false \
  --out "$FINAL_APK" \
  "$ALIGNED_APK"

echo ""
echo "✅ ساخت موفق!"
echo "APK نهایی: $FINAL_APK"
ls -lh "$FINAL_APK"
echo "Keystore: $KEYSTORE_FILE"
echo "برای نصب: adb install -r $FINAL_APK"
