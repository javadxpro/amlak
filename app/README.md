# اپلیکیشن اندروید املاک حامدی

پکیج: `ir.hamedi.amlak` - جاوای خالص + WebView (بدون Kotlin/AndroidX/Gradle)

## ویژگی‌ها
- رابط کاربری مطابق تنظیمات `index.html` سایت اصلی:
  - رنگ‌ها: `--brand:#0e7a5f`, `--brand-2:#0a5c47`, `--brand-dark:#0b3b31`, `--gold:#d9a13b`, `--bg:#f4f7f5` و...
  - برند: املاک جواد حامدی - شوش دانیال
  - فرمت قیمت: همان تابع `money()` سایت (میلیارد/میلیون/هزار با اعداد فارسی)
  - اسکیمای ۲۱ فیلدی `properties.json` با همان ترتیب کلیدها (جدید: `shenazh` برای شناژبندی):
    `id, title, neighborhood, deal, type, area, rooms, floor, buildYear, price, pricePerMeter, deposit, rent, inAlley, parking, elevator, storage, shenazh, image, description, features`

- دریافت لیست از:
  - `https://raw.githubusercontent.com/javadxpro/amlak/refs/heads/main/properties.json`
  - fallback: `https://javadxpro.github.io/amlak/properties.json`
  - در صورت آفلاین بودن، از حافظه محلی (localStorage)

- قابلیت‌ها:
  - افزودن/ویرایش/حذف ملک (شامل شناژبندی)
  - جستجو و فیلتر (نوع معامله، نوع ملک، موقعیت، خواب، متراژ، شناژبندی)
  - دکمه «استخراج» که فایل را در `/storage/emulated/0/Documents/properties.json` می‌نویسد:
    - اندروید ۱۰+ (API 29+): با MediaStore
    - قدیمی‌تر: با مجوز `WRITE_EXTERNAL_STORAGE`

- `minSdk 21`, `targetSdk 34`

## ساخت بدون Android SDK

ابزارها:
- از npm: `@drxiaozhi/minapk` برای `android.jar`, `d8`, `ecj`, `apksigner`
- از npm: `aaptjs3` برای `aapt2`
- جاوا از PyPI: `jdk4py`

### مراحل ساخت

```bash
cd app
npm install
bash build.sh
```

خروجی:
- APK امضاشده: `app/release/amlak-hamedi.apk`
- Keystore: `app/keystore/amlak.keystore`

### اسکریپت‌ها
- `build.sh`: اسکریپت اصلی ساخت
  - کامپایل منابع با aapt2
  - لینک manifest و assets
  - کامپایل جاوا با ecj
  - تبدیل به dex با d8
  - بسته‌بندی و هم‌ترازی با `apkpack.js`
  - امضا با apksigner
- `apkpack.js`: پیاده‌سازی هم‌ترازی ZIP (zipalign) به صورت خالص JS
  - دستور `pack`: افزودن classes.dex به resources.apk
  - دستور `align`: هم‌تراز کردن فایل‌ها روی مرز ۴ بایت

## ساخت خودکار (GitHub Actions)

Workflow در `.github/workflows/build-apk.yml` به صورت خودکار در هر push روی main یا PR، APK را می‌سازد و به عنوان artifact آپلود می‌کند.

## نصب

```bash
adb install -r app/release/amlak-hamedi.apk
```

یا فایل APK را مستقیماً روی گوشی باز کنید.

## مجوزها
- `INTERNET`, `ACCESS_NETWORK_STATE`
- `WRITE_EXTERNAL_STORAGE` و `READ_EXTERNAL_STORAGE` (فقط تا API 28)

## نکات
- اپ کاملاً آفلاین هم کار می‌کند (داده‌ها در localStorage ذخیره می‌شوند)
- هنگام استخراج، فایل قبلی در Documents حذف و فایل جدید جایگزین می‌شود
- لوگو و آیکون‌ها همان SVG سایت اصلی هستند
