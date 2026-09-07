/*
  سرور محلی سایت املاک جواد حامدی
  — فقط با ماژول‌های داخلی Node.js نوشته شده، هیچ پکیجی لازم ندارد —
  اجرا:   npm start      (یا:  node server.js)
  سپس مرورگر:  http://localhost:3000
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.md':   'text/markdown; charset=utf-8'
};

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); return res.end('Bad request');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const file = path.join(ROOT, path.normalize(urlPath));
  if (!file.startsWith(ROOT)) {           // جلوگیری از خروج از پوشه
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — فایل پیدا نشد: ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'   // همیشه آخرین نسخه، نه کش قدیمی
    });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log('✓ سایت اجرا شد:  http://localhost:' + PORT);
});
