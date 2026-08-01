#!/usr/bin/env node
'use strict';

/*
 * EduLift static-site generator (no dependencies).
 * Run with: node tools/generate.js
 *
 * Reads simulators.json and writes:
 *   sitemap.xml, robots.txt, rss.xml, llms.txt,
 *   site.webmanifest, favicon.ico, favicon.svg, apple-touch-icon.png,
 *   icon-192.png, icon-512.png, og-image.png
 *   simulators/<slug>/og-image.png (per simulator)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const SITE = {
  name: 'EduLift',
  url: 'https://edu-lift-omega.vercel.app',
  shortName: 'EduLift',
  title: 'EduLift — Interactive 3D Simulators',
  description:
    'Free interactive 3D simulators for learning science and engineering. Explore a 3D circulatory system and a power transformer, part by part.',
  tagline: 'Interactive 3D simulators for learning',
  keywords: [
    'educational simulator',
    '3D interactive learning',
    'circulatory system',
    'heart anatomy',
    'power transformer',
    'science simulator',
    'engineering simulator',
    'online lab',
  ],
  author: 'EduLift',
};

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'simulators.json'), 'utf8'));
} catch (err) {
  console.error('Cannot read simulators.json:', err.message);
  process.exit(1);
}

const sims = Array.isArray(manifest.simulators) ? manifest.simulators : [];
const today = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ *
 * PNG encoder
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    buf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

/* ------------------------------------------------------------------ *
 * Pixel drawing (premultiplied alpha)
 * ------------------------------------------------------------------ */

function colorFromHex(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 255,
  };
}

function shade(c, f) {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f), a: c.a };
}

function setPx(pix, w, h, x, y, c) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  const sa = c.a / 255;
  if (sa <= 0) return;
  const da = pix[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  pix[i] = Math.round(c.r * sa * 255 + pix[i] * (1 - sa));
  pix[i + 1] = Math.round(c.g * sa * 255 + pix[i + 1] * (1 - sa));
  pix[i + 2] = Math.round(c.b * sa * 255 + pix[i + 2] * (1 - sa));
  pix[i + 3] = Math.round(oa * 255);
}

function fillRect(pix, w, h, x0, y0, x1, y1, c) {
  const xi0 = Math.max(0, Math.floor(Math.min(x0, x1)));
  const xi1 = Math.min(w - 1, Math.floor(Math.max(x0, x1)));
  const yi0 = Math.max(0, Math.floor(Math.min(y0, y1)));
  const yi1 = Math.min(h - 1, Math.floor(Math.max(y0, y1)));
  for (let y = yi0; y <= yi1; y++) for (let x = xi0; x <= xi1; x++) setPx(pix, w, h, x, y, c);
}

function fillRoundRect(pix, w, h, x0, y0, x1, y1, rad, c) {
  const xi0 = Math.max(0, Math.floor(Math.min(x0, x1)));
  const xi1 = Math.min(w - 1, Math.floor(Math.max(x0, x1)));
  const yi0 = Math.max(0, Math.floor(Math.min(y0, y1)));
  const yi1 = Math.min(h - 1, Math.floor(Math.max(y0, y1)));
  for (let y = yi0; y <= yi1; y++) {
    for (let x = xi0; x <= xi1; x++) {
      const cx = Math.max(x0 + rad, Math.min(x + 0.5, x1 - rad));
      const cy = Math.max(y0 + rad, Math.min(y + 0.5, y1 - rad));
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= rad * rad + 0.5) setPx(pix, w, h, x, y, c);
    }
  }
}

function fillVgradient(pix, w, h, c1, c2) {
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const c = {
      r: Math.round(c1.r + (c2.r - c1.r) * t),
      g: Math.round(c1.g + (c2.g - c1.g) * t),
      b: Math.round(c1.b + (c2.b - c1.b) * t),
      a: 255,
    };
    fillRect(pix, w, h, 0, y, w, y, c);
  }
}

function drawLine(pix, w, h, x0, y0, x1, y1, thick, c) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    fillRect(pix, w, h, x - thick, y - thick, x + thick, y + thick, c);
  }
}

function fillCircle(pix, w, h, cx, cy, r, c) {
  const x0 = Math.floor(cx - r);
  const x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r);
  const y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) setPx(pix, w, h, x, y, c);
    }
  }
}

function downsample(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let oy = 0; oy < dh; oy++) {
    for (let ox = 0; ox < dw; ox++) {
      const x0 = Math.floor((ox * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * sw) / dw) - 1);
      const y0 = Math.floor((oy * sh) / dh);
      const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * sh) / dh) - 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy <= y1; sy++) {
        for (let sx = x0; sx <= x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const oi = (oy * dw + ox) * 4;
      if (a > 0) {
        out[oi] = Math.round((r * 255) / a);
        out[oi + 1] = Math.round((g * 255) / a);
        out[oi + 2] = Math.round((b * 255) / a);
      }
      out[oi + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5x7 pixel font (uppercase)
 * ------------------------------------------------------------------ */

const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
};

function textWidth(text, scale) {
  return (text.length * 6 - 1) * scale;
}

function drawText(pix, w, h, text, centerX, centerY, scale, c) {
  const totalW = textWidth(text, scale);
  let x0 = Math.round(centerX - totalW / 2);
  const y0 = Math.round(centerY - 3.5 * scale);
  for (const raw of text) {
    const glyph = FONT[raw.toUpperCase()] || FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[r][col] === '1') {
          fillRect(pix, w, h, x0 + col * scale, y0 + r * scale, x0 + (col + 1) * scale, y0 + (r + 1) * scale, c);
        }
      }
    }
    x0 += 6 * scale;
  }
}

/* ------------------------------------------------------------------ *
 * Graduation-cap icon
 * ------------------------------------------------------------------ */

function drawCap(pix, w, h, cx, cy, size, c) {
  const rx = size * 0.42;
  const ry = size * 0.24;
  const x0 = cx - rx;
  const x1 = cx + rx;
  const y0 = cy - ry;
  const y1 = cy + ry;
  for (let y = Math.floor(y0); y <= y1; y++) {
    for (let x = Math.floor(x0); x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dx) + Math.abs(dy) <= 1) setPx(pix, w, h, x, y, c);
    }
  }
  const skull = shade(c, 0.8);
  fillRoundRect(pix, w, h, cx - size * 0.2, cy, cx + size * 0.2, cy + size * 0.3, size * 0.08, skull);
  fillCircle(pix, w, h, cx, cy - ry - size * 0.02, size * 0.045, shade(c, 1.25));
  const light = { r: 230, g: 236, b: 244, a: 255 };
  fillCircle(pix, w, h, cx + rx + size * 0.06, cy - size * 0.1, size * 0.05, light);
  drawLine(pix, w, h, cx + rx - size * 0.04, cy, cx + rx + size * 0.06, cy - size * 0.1, size * 0.018, light);
}

function renderIcon(size, accentHex) {
  const S = 4;
  const w = size * S;
  const h = size * S;
  const pix = new Uint8Array(w * h * 4);
  fillVgradient(pix, w, h, colorFromHex('#1a2432'), colorFromHex('#0a0e14'));
  const margin = size * S * 0.06;
  fillRoundRect(pix, w, h, 0, 0, w, h, size * S * 0.22, { r: 255, g: 255, b: 255, a: 0 });
  const cx = w / 2;
  const cy = h / 2 + size * S * 0.03;
  drawCap(pix, w, h, cx, cy, size * S * 0.56, colorFromHex(accentHex));
  return encodePNG(size, size, downsample(pix, w, h, size, size));
}

/* ------------------------------------------------------------------ *
 * OG image (1200x630)
 * ------------------------------------------------------------------ */

function renderOG(title, tagline, accentHex) {
  const W = 1200;
  const H = 630;
  const S = 2;
  const w = W * S;
  const h = H * S;
  const pix = new Uint8Array(w * h * 4);
  fillVgradient(pix, w, h, colorFromHex('#131c2a'), colorFromHex('#0a0f16'));
  fillRect(pix, w, h, 0, 0, w, 10 * S, colorFromHex(accentHex));
  fillRect(pix, w, h, 0, h - 6 * S, w, h, shade(colorFromHex(accentHex), 0.6));

  const accent = colorFromHex(accentHex);
  drawCap(pix, w, h, (W / 2) * S, 175 * S, 150 * S, accent);

  const titleUpper = String(title).toUpperCase();
  const scale = Math.min(14, Math.floor((W - 180) / (6 * titleUpper.length - 1)));
  drawText(pix, w, h, titleUpper, (W / 2) * S, 460 * S, scale * S, { r: 226, g: 232, b: 240, a: 255 });
  drawText(pix, w, h, String(tagline).toUpperCase(), (W / 2) * S, 520 * S, 5 * S, { r: 141, g: 160, b: 184, a: 255 });

  return encodePNG(W, H, downsample(pix, w, h, W, H));
}

/* ------------------------------------------------------------------ *
 * Text outputs
 * ------------------------------------------------------------------ */

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sitemapXml() {
  const urls = [
    { loc: SITE.url + '/', priority: '1.0', changefreq: 'weekly' },
    ...sims.map((s) => ({
      loc: `${SITE.url}/simulators/${s.slug}/`,
      priority: '0.9',
      changefreq: 'monthly',
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function robotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE.url}/sitemap.xml
`;
}

function rssXml() {
  const items = sims
    .map((s) => {
      const link = `${SITE.url}/simulators/${s.slug}/`;
      const img = `${SITE.url}/simulators/${s.slug}/og-image.png`;
      return `    <item>\n      <title>${escapeXml(s.name)}</title>\n      <link>${escapeXml(link)}</link>\n      <guid>${escapeXml(link)}</guid>\n      <description>${escapeXml(s.tagline)}</description>\n      <pubDate>${today}</pubDate>\n      <enclosure url="${escapeXml(img)}" type="image/png" length="0"/>\n    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE.name)} — Simulators</title>
    <link>${escapeXml(SITE.url)}</link>
    <description>${escapeXml(SITE.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${today}</lastBuildDate>
    ${items}
  </channel>
</rss>
`;
}

function llmsTxt() {
  const lines = [`# ${SITE.name}`, '', SITE.description, '', '## Home', '', `- ${SITE.url}/ : ${SITE.title}`, ''];
  if (sims.length) {
    lines.push('## Simulators', '');
    for (const s of sims) {
      lines.push(`- ${SITE.url}/simulators/${s.slug}/ : ${s.name} — ${s.tagline}`);
    }
  }
  return lines.join('\n') + '\n';
}

function webmanifest() {
  const icon = (src, sizes, purpose) => ({ src, sizes, type: 'image/png', purpose });
  return JSON.stringify(
    {
      name: SITE.title,
      short_name: SITE.shortName,
      description: SITE.description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0a0e14',
      theme_color: '#0a0e14',
      icons: [icon('/icon-192.png', '192x192', 'any maskable'), icon('/icon-512.png', '512x512', 'any maskable')],
    },
    null,
    2
  ) + '\n';
}

/* ------------------------------------------------------------------ *
 * Favicon SVG
 * ------------------------------------------------------------------ */

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0e14"/>
  <path d="M32 16 L57 28 L32 40 L7 28 Z" fill="#38bdf8"/>
  <path d="M32 34.5 L32 46" stroke="#2c89bd" stroke-width="2"/>
  <rect x="24" y="40" width="16" height="9" rx="3" fill="#2c89bd"/>
  <circle cx="50" cy="24" r="3.4" fill="#e8eef6"/>
  <path d="M50 24 L56 18" stroke="#e8eef6" stroke-width="2"/>
</svg>
`;

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function write(relPath, content) {
  const target = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  console.log('wrote', relPath);
}

function main() {
  const accent = (manifest.accent && manifest.accent) || '#38bdf8';

  write('sitemap.xml', sitemapXml());
  write('robots.txt', robotsTxt());
  write('rss.xml', rssXml());
  write('llms.txt', llmsTxt());
  write('site.webmanifest', webmanifest());
  write('favicon.svg', FAVICON_SVG);

  const ico = encodeICO(
    [16, 32, 48].map((size) => ({ size, png: renderIcon(size, accent) }))
  );
  write('favicon.ico', ico);
  write('apple-touch-icon.png', renderIcon(180, accent));
  write('icon-192.png', renderIcon(192, accent));
  write('icon-512.png', renderIcon(512, accent));
  write('og-image.png', renderOG(SITE.name, SITE.tagline, accent));

  for (const s of sims) {
    if (!s.slug) continue;
    const simAccent = (s.accent && s.accent) || accent;
    write(`simulators/${s.slug}/og-image.png`, renderOG(s.name, s.tagline, simAccent));
  }

  console.log('Done.');
}

main();
