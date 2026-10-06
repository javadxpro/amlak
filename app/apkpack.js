#!/usr/bin/env node
/**
 * apkpack.js - ابزار هم‌ترازی ZIP و بسته‌بندی APK برای املاک حامدی
 * بدون نیاز به zipalign باینری - پیاده‌سازی خالص JS
 *
 * دستورات:
 *   node apkpack.js pack --input resources.apk --dex classes.dex --output unsigned.apk
 *   node apkpack.js align --input unsigned.apk --output aligned.apk
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  return { dosTime, dosDate };
}

// ---------- ZIP parsing ----------
function findEOCD(buf) {
  // EOCD signature 0x06054b50, search from end
  const maxComment = 65535;
  const minEOCDSize = 22;
  const start = Math.max(0, buf.length - minEOCDSize - maxComment);
  for (let i = buf.length - minEOCDSize; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

function parseZip(buf) {
  const eocdOff = findEOCD(buf);
  if (eocdOff < 0) throw new Error('EOCD not found - not a valid ZIP/APK');
  const cdCount = buf.readUInt16LE(eocdOff + 8);
  const cdSize = buf.readUInt32LE(eocdOff + 12);
  const cdOffset = buf.readUInt32LE(eocdOff + 16);

  const entries = [];
  let offset = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid central directory signature at ' + offset);
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const dosTime = buf.readUInt16LE(offset + 12);
    const dosDate = buf.readUInt16LE(offset + 14);
    const crc = buf.readUInt32LE(offset + 16);
    const compSize = buf.readUInt32LE(offset + 20);
    const uncompSize = buf.readUInt32LE(offset + 24);
    const fnameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOff = buf.readUInt32LE(offset + 42);
    const fname = buf.slice(offset + 46, offset + 46 + fnameLen);
    const extra = buf.slice(offset + 46 + fnameLen, offset + 46 + fnameLen + extraLen);
    // const comment = buf.slice(offset + 46 + fnameLen + extraLen, offset + 46 + fnameLen + extraLen + commentLen);

    // Parse local header to get data offset
    const localOff = localHeaderOff;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Invalid local header at ' + localOff);
    const localFnameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localFnameLen + localExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);

    let uncompData;
    if (method === 0) {
      uncompData = compData;
    } else if (method === 8) {
      try {
        uncompData = zlib.inflateRawSync(compData);
      } catch (e) {
        // If inflate fails, keep compressed (might be stored differently)
        uncompData = null;
      }
    } else {
      uncompData = null;
    }

    entries.push({
      filename: fname.toString('utf8'),
      filenameBuf: fname,
      extra: extra,
      crc: crc,
      method: method,
      compSize: compSize,
      uncompSize: uncompSize,
      compData: compData,
      uncompData: uncompData,
      dosTime: dosTime,
      dosDate: dosDate,
      flags: flags,
      localHeaderOff: localHeaderOff
    });

    offset += 46 + fnameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- ZIP writing with alignment ----------
function writeAlignedZip(entries, outputPath, alignment = 4) {
  // entries: [{filename, filenameBuf?, uncompData (Buffer), compData?, method, extra?, dosTime, dosDate, flags}]
  // Ensure each entry has uncompData, and we will recompress if method=8

  const outBuffers = [];
  let currentOffset = 0;
  const cdRecords = [];

  const now = dosDateTime(new Date());

  for (const entry of entries) {
    const fnameStr = entry.filename;
    const fnameBuf = entry.filenameBuf || Buffer.from(fnameStr, 'utf8');
    const fnameLen = fnameBuf.length;

    // Prepare uncompressed data
    let uncomp = entry.uncompData;
    if (!uncomp) {
      // if we have compData and method 0, uncomp = compData
      if (entry.compData && entry.method === 0) {
        uncomp = entry.compData;
      } else if (entry.compData && entry.method === 8) {
        try {
          uncomp = zlib.inflateRawSync(entry.compData);
        } catch {
          uncomp = entry.compData; // fallback
        }
      } else {
        uncomp = Buffer.alloc(0);
      }
    }

    // Decide compression method: keep original if exists, else DEFLATE for most, STORE for known uncompressed types?
    // For APK, resources.arsc and .so should be STORE. We'll keep original method for existing entries.
    // For new dex, use DEFLATE (8) but zipalign will still align.
    let method = entry.method;
    if (method === undefined || method === null) {
      // default: DEFLATE unless extension is .so, .arsc, etc.
      if (fnameStr.endsWith('.so') || fnameStr.endsWith('.arsc') || fnameStr === 'resources.arsc') {
        method = 0;
      } else {
        method = 8;
      }
    }

    let compData;
    let compSize;
    let uncompSize = uncomp.length;
    let crc = entry.crc;

    if (method === 0) {
      compData = uncomp;
      compSize = uncompSize;
      crc = crc32(uncomp);
    } else {
      // DEFLATE
      compData = zlib.deflateRawSync(uncomp, { level: 9 });
      compSize = compData.length;
      crc = crc32(uncomp);
      // If compressed is larger than uncompressed and original was STORE, keep STORE? but we respect method.
      // For simplicity keep DEFLATE.
    }

    // Existing extra
    let extra = entry.extra || Buffer.alloc(0);

    // Calculate padding for alignment
    // local header size = 30 + fnameLen + extraLen
    // data offset = currentOffset + 30 + fnameLen + extra.length
    // we want data offset % alignment == 0
    // So padding = (alignment - (dataOffset % alignment)) % alignment
    // We add padding as extra field: we can just increase extra with zeros, but to be valid, create extra field with header 0x0000?
    // Simplest: add padding bytes as part of extra (raw zeros) - works for alignment, though not standard extra field.
    // Better: create extra field with id 0xd935 (Android alignment) - but we will just pad with zeros and increase extra length.

    let extraLen = extra.length;
    let headerSize = 30 + fnameLen + extraLen;
    let dataOffset = currentOffset + headerSize;
    let padding = (alignment - (dataOffset % alignment)) % alignment;

    // If padding needed, add extra bytes
    if (padding > 0) {
      // Create padding extra: we will add an extra field with id 0x0000 and size = padding, or just zeros?
      // Use standard zipalign extra: id 0xd935, size padding, data zeros
      // For simplicity, just add Buffer.alloc(padding) to extra
      // But to be more correct, add as extra field: 2 bytes id + 2 bytes size + data
      // We'll use id 0xd935, size = padding, data = zeros(padding)
      // However that would add 4 + padding bytes, not just padding. So we need to compute correctly.
      // Instead, we add raw zeros as extra - many zip tools accept raw extra.
      // Let's do: extra = Buffer.concat([extra, Buffer.alloc(padding)])
      extra = Buffer.concat([extra, Buffer.alloc(padding)]);
      extraLen = extra.length;
      // Recalculate headerSize and dataOffset (now aligned)
      headerSize = 30 + fnameLen + extraLen;
      dataOffset = currentOffset + headerSize;
      // Verify aligned
      if (dataOffset % alignment !== 0) {
        // If still not aligned due to miscalc, adjust again (should not happen)
        const extraPadding = (alignment - (dataOffset % alignment)) % alignment;
        if (extraPadding > 0) {
          extra = Buffer.concat([extra, Buffer.alloc(extraPadding)]);
          extraLen = extra.length;
        }
      }
    }

    const dosTime = entry.dosTime || now.dosTime;
    const dosDate = entry.dosDate || now.dosDate;
    const flags = entry.flags !== undefined ? entry.flags : 0x0800; // UTF-8

    // Local file header
    const localHeader = Buffer.alloc(30 + fnameLen + extraLen);
    let off = 0;
    localHeader.writeUInt32LE(0x04034b50, off); off += 4;
    localHeader.writeUInt16LE(20, off); off += 2; // version needed
    localHeader.writeUInt16LE(flags, off); off += 2;
    localHeader.writeUInt16LE(method, off); off += 2;
    localHeader.writeUInt16LE(dosTime, off); off += 2;
    localHeader.writeUInt16LE(dosDate, off); off += 2;
    localHeader.writeUInt32LE(crc, off); off += 4;
    localHeader.writeUInt32LE(compSize, off); off += 4;
    localHeader.writeUInt32LE(uncompSize, off); off += 4;
    localHeader.writeUInt16LE(fnameLen, off); off += 2;
    localHeader.writeUInt16LE(extraLen, off); off += 2;
    fnameBuf.copy(localHeader, off); off += fnameLen;
    extra.copy(localHeader, off); off += extraLen;

    outBuffers.push(localHeader);
    outBuffers.push(compData);
    currentOffset += localHeader.length + compData.length;

    cdRecords.push({
      filename: fnameStr,
      filenameBuf: fnameBuf,
      extra: extra,
      crc: crc,
      method: method,
      compSize: compSize,
      uncompSize: uncompSize,
      dosTime: dosTime,
      dosDate: dosDate,
      flags: flags,
      localHeaderOffset: currentOffset - (localHeader.length + compData.length)
    });
  }

  // Central directory
  const cdStartOffset = currentOffset;
  let cdSize = 0;
  for (const rec of cdRecords) {
    const fnameBuf = rec.filenameBuf;
    const fnameLen = fnameBuf.length;
    const extraLen = rec.extra.length;
    const commentLen = 0;
    const cdHeader = Buffer.alloc(46 + fnameLen + extraLen + commentLen);
    let off = 0;
    cdHeader.writeUInt32LE(0x02014b50, off); off += 4;
    cdHeader.writeUInt16LE(20, off); off += 2; // version made by
    cdHeader.writeUInt16LE(20, off); off += 2; // version needed
    cdHeader.writeUInt16LE(rec.flags, off); off += 2;
    cdHeader.writeUInt16LE(rec.method, off); off += 2;
    cdHeader.writeUInt16LE(rec.dosTime, off); off += 2;
    cdHeader.writeUInt16LE(rec.dosDate, off); off += 2;
    cdHeader.writeUInt32LE(rec.crc, off); off += 4;
    cdHeader.writeUInt32LE(rec.compSize, off); off += 4;
    cdHeader.writeUInt32LE(rec.uncompSize, off); off += 4;
    cdHeader.writeUInt16LE(fnameLen, off); off += 2;
    cdHeader.writeUInt16LE(extraLen, off); off += 2;
    cdHeader.writeUInt16LE(commentLen, off); off += 2;
    cdHeader.writeUInt16LE(0, off); off += 2; // disk number
    cdHeader.writeUInt16LE(0, off); off += 2; // internal attrs
    cdHeader.writeUInt32LE(0, off); off += 4; // external attrs
    cdHeader.writeUInt32LE(rec.localHeaderOffset, off); off += 4;
    fnameBuf.copy(cdHeader, off); off += fnameLen;
    rec.extra.copy(cdHeader, off); off += extraLen;
    // comment none
    outBuffers.push(cdHeader);
    currentOffset += cdHeader.length;
    cdSize += cdHeader.length;
  }

  // EOCD
  const eocd = Buffer.alloc(22);
  let off = 0;
  eocd.writeUInt32LE(0x06054b50, off); off += 4;
  eocd.writeUInt16LE(0, off); off += 2; // disk number
  eocd.writeUInt16LE(0, off); off += 2; // cd disk
  eocd.writeUInt16LE(cdRecords.length, off); off += 2; // cd count disk
  eocd.writeUInt16LE(cdRecords.length, off); off += 2; // cd count total
  eocd.writeUInt32LE(cdSize, off); off += 4;
  eocd.writeUInt32LE(cdStartOffset, off); off += 4;
  eocd.writeUInt16LE(0, off); off += 2; // comment len

  outBuffers.push(eocd);

  const finalBuf = Buffer.concat(outBuffers);
  fs.writeFileSync(outputPath, finalBuf);
  console.log(`✅ APK نوشته شد: ${outputPath} (${finalBuf.length} بایت) - ${cdRecords.length} فایل، تراز ${alignment} بایت`);
}

// ---------- commands ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      opts[key] = val;
    }
  }
  return { cmd, opts };
}

function main() {
  const { cmd, opts } = parseArgs();

  if (cmd === 'pack') {
    const input = opts.input;
    const dex = opts.dex;
    const output = opts.output;
    if (!input || !dex || !output) {
      console.error('Usage: node apkpack.js pack --input resources.apk --dex classes.dex --output unsigned.apk');
      process.exit(1);
    }
    console.log(`📦 بسته‌بندی: ${input} + ${dex} -> ${output}`);
    const zipBuf = fs.readFileSync(input);
    const entries = parseZip(zipBuf);

    // Read dex
    const dexData = fs.readFileSync(dex);

    // Check if classes.dex already exists, replace
    const filtered = entries.filter(e => e.filename !== 'classes.dex');

    // Prepare new entry for dex
    const newEntries = filtered.map(e => ({
      filename: e.filename,
      filenameBuf: Buffer.from(e.filename, 'utf8'),
      extra: e.extra,
      method: e.method,
      compData: e.compData,
      uncompData: e.uncompData,
      crc: e.crc,
      dosTime: e.dosTime,
      dosDate: e.dosDate,
      flags: e.flags
    }));

    newEntries.push({
      filename: 'classes.dex',
      filenameBuf: Buffer.from('classes.dex', 'utf8'),
      uncompData: dexData,
      method: 8, // DEFLATE
      extra: Buffer.alloc(0),
      flags: 0x0800
    });

    writeAlignedZip(newEntries, output, 4);

  } else if (cmd === 'align') {
    const input = opts.input;
    const output = opts.output;
    if (!input || !output) {
      console.error('Usage: node apkpack.js align --input unsigned.apk --output aligned.apk');
      process.exit(1);
    }
    console.log(`📐 هم‌ترازی: ${input} -> ${output}`);
    const zipBuf = fs.readFileSync(input);
    const entries = parseZip(zipBuf);
    const newEntries = entries.map(e => ({
      filename: e.filename,
      filenameBuf: Buffer.from(e.filename, 'utf8'),
      extra: e.extra,
      method: e.method,
      compData: e.compData,
      uncompData: e.uncompData,
      crc: e.crc,
      dosTime: e.dosTime,
      dosDate: e.dosDate,
      flags: e.flags
    }));
    writeAlignedZip(newEntries, output, 4);

  } else {
    console.log(`apkpack.js - ابزار بسته‌بندی و هم‌ترازی APK
دستورات:
  pack  --input <resources.apk> --dex <classes.dex> --output <unsigned.apk>
  align --input <unsigned.apk> --output <aligned.apk>

این ابزار پیاده‌سازی ساده‌ای از zipalign است که فایل‌ها را روی مرز ۴ بایت هم‌تراز می‌کند.
`);
    process.exit(0);
  }
}

main();
