# -*- coding: utf-8 -*-
"""
همگام‌سازی properties.json با index.html
بعد از هر تغییر در properties.json این دستور را اجرا کنید:
    python3 sync.py
"""
import json, re, pathlib

base = pathlib.Path(__file__).parent
data = json.dumps(
    json.load(open(base / 'properties.json', encoding='utf-8')),
    ensure_ascii=False, separators=(',', ':')
)
html = (base / 'index.html').read_text(encoding='utf-8')

new, n = re.subn(
    r'(<!--DATA:START-->\s*<script type="application/json" id="data-embedded">).*?(</script>\s*<!--DATA:END-->)',
    lambda m: m.group(1) + data + m.group(2),
    html, flags=re.S
)
if n != 1:
    raise SystemExit('✗ بخش داده در index.html پیدا نشد!')
(base / 'index.html').write_text(new, encoding='utf-8')
print('✓ properties.json داخل index.html همگام‌سازی شد')
