#!/usr/bin/env node
// Rewrites an 8-bit RGB PNG as RGBA (colour type 6, every pixel fully opaque). Google Play asks for
// the 512 x 512 app icon as a "32-bit PNG (with alpha)"; Chrome screenshots of an opaque page come
// out as 24-bit RGB. Pure Node (zlib), no browser needed.
//
//   node scripts/png-rgba.mjs docs/play/graphics/icon-512.png
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Parse a PNG into { ihdr, chunks: [{type, data}] }. */
function parse(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const h = chunks[0].data;
  return {
    chunks,
    width: h.readUInt32BE(0), height: h.readUInt32BE(4), depth: h[8], colorType: h[9], interlace: h[12],
  };
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Returns the PNG as RGBA (unchanged when it already is). Throws on formats it does not handle. */
export function toRGBA(buf) {
  const png = parse(buf);
  if (png.colorType === 6) return buf;
  if (png.colorType !== 2 || png.depth !== 8 || png.interlace !== 0) {
    throw new Error(`unsupported PNG (colour type ${png.colorType}, depth ${png.depth}, interlace ${png.interlace})`);
  }
  const { width: w, height: h } = png;
  const raw = zlib.inflateSync(Buffer.concat(png.chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const bpp = 3;
  const stride = w * bpp;
  const out = Buffer.alloc(h * (1 + w * 4));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) line[x] = (line[x] + paeth(a, b, c)) & 255;
    }
    const o = y * (1 + w * 4);
    out[o] = 0;
    for (let x = 0; x < w; x++) {
      out[o + 1 + x * 4] = line[x * 3];
      out[o + 2 + x * 4] = line[x * 3 + 1];
      out[o + 3 + x * 4] = line[x * 3 + 2];
      out[o + 4 + x * 4] = 255;
    }
    prev = line;
  }
  const ihdr = Buffer.from(png.chunks[0].data);
  ihdr[9] = 6;
  const keep = png.chunks.filter((c) => !['IHDR', 'IDAT', 'IEND', 'tRNS'].includes(c.type));
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    ...keep.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', zlib.deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function ensureRGBA(file) {
  const buf = fs.readFileSync(file);
  const outBuf = toRGBA(buf);
  if (outBuf !== buf) fs.writeFileSync(file, outBuf);
  return outBuf !== buf;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const f of process.argv.slice(2)) console.log(`${f}: ${ensureRGBA(f) ? 'converted to RGBA' : 'already RGBA'}`);
}
