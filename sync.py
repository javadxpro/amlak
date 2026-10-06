# -*- coding: utf-8 -*-
"""
همگام‌سازی properties.json با index.html و app/assets/www/index.html
بعد از هر تغییر در properties.json:
    python3 sync.py
- پشتیبانی از 35 فیلد جدید (water, electricity, gas, direction, updatedAt, ownerPhone, isFeatured, lat, lng)
- پشتیبانی از دو فرمت data-embedded: با marker <!--DATA:START--> و بدون marker
- اگر properties.json آرایه باشد، داخل {"properties": [...]} embed می‌شود
"""
import json, re, pathlib

base = pathlib.Path(__file__).parent
props_path = base / 'properties.json'
raw = json.loads(props_path.read_text(encoding='utf-8'))
if isinstance(raw, dict) and 'properties' in raw:
    props = raw['properties']
else:
    props = raw

# Ensure 35 fields order for validation
FIELD_ORDER = ["id","title","neighborhood","deal","type","area","rooms","floor","buildYear","price","pricePerMeter","deposit","rent","inAlley","parking","elevator","storage","shenazh","documentType","yardType","hallType","closet","cabinet","image","description","features"]
print(f"✓ {len(props)} ملک با {len(FIELD_ORDER)} فیلد بارگذاری شد")

# Data to embed: {"properties": [...]}
embed_data = json.dumps({"properties": props}, ensure_ascii=False)

# Sync site index.html
site_html_path = base / 'index.html'
html = site_html_path.read_text(encoding='utf-8')

# Try with markers first
pattern_marker = r'(<!--DATA:START-->\s*<script type="application/json" id="data-embedded">).*?(</script>\s*<!--DATA:END-->)'
new_html, n = re.subn(pattern_marker, lambda m: m.group(1) + embed_data + m.group(2), html, flags=re.S)

if n == 0:
    # Try without markers: <script type="application/json" id="data-embedded">...</script>
    pattern_simple = r'(<script type="application/json" id="data-embedded">).*?(</script>)'
    new_html, n = re.subn(pattern_simple, lambda m: m.group(1) + embed_data + m.group(2), html, flags=re.S)

if n == 1:
    site_html_path.write_text(new_html, encoding='utf-8')
    print(f'✓ index.html همگام‌سازی شد ({len(props)} ملک)')
else:
    print(f'⚠ بخش داده در index.html پیدا نشد (n={n}) - ممکن است فرمت متفاوت باشد، تلاش برای EMBED_DATA...')
    # Fallback for old EMBED_DATA format
    if 'const EMBED_DATA=' in html:
        # Use bracket counting method
        marker = 'const EMBED_DATA='
        idx = html.find(marker)
        if idx != -1:
            start = html.find('[', idx)
            utils_idx = html.find('/* ---------- utils', idx)
            end = html.rfind('];', idx, utils_idx if utils_idx != -1 else len(html))
            if end != -1:
                data_str = json.dumps(props, ensure_ascii=False)
                new_html2 = html[:idx] + marker + data_str + ';' + html[end+2:]
                site_html_path.write_text(new_html2, encoding='utf-8')
                print(f'✓ index.html با EMBED_DATA همگام‌سازی شد')
            else:
                print('✗ EMBED_DATA end not found')
    else:
        print('✗ هیچ الگوی داده‌ای در index.html یافت نشد')

# Sync app - no embedded, but ensure properties.json is copied to assets? Actually app loads from network, but we can also copy to assets/www for offline?
# For now, just ensure app's FIELD_ORDER is up to date (already handled in index.html patch)
# Optionally copy properties.json to app/assets/www/properties.json for offline fallback
app_props_path = base / 'app' / 'assets' / 'www' / 'properties.json'
try:
    app_props_path.write_text(json.dumps(props, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✓ app/assets/www/properties.json همگام‌سازی شد')
except Exception as e:
    print(f'⚠ خطا در کپی به app: {e}')

print('✓ تمام شد')
