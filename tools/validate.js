#!/usr/bin/env node
'use strict';

/* Quick offline QA for the EduLift static site. Run: node tools/validate.js */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const URL = 'https://edu-lift-omega.vercel.app';
const errors = [];
const ok = (m) => console.log('  ok:', m);
const err = (m) => errors.push(m);

/* ---- 1. simulators.json validity + consistency ---- */
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'simulators.json'), 'utf8'));
  ok('simulators.json parses');
} catch (e) {
  err('simulators.json invalid JSON: ' + e.message);
  process.exit(1);
}
const slugs = [];
for (const s of manifest.simulators || []) {
  slugs.push(s.slug);
  if (!s.slug || !s.name || !s.tagline || !s.icon || !s.category || !s.accent) {
    err(`simulator "${s.slug || s.name}" missing a required field (slug/name/tagline/icon/category/accent)`);
  }
  const html = path.join(ROOT, 'simulators', s.slug, 'index.html');
  if (!fs.existsSync(html)) err(`simulator index.html missing: simulators/${s.slug}/index.html`);
  if (!fs.existsSync(path.join(ROOT, 'simulators', s.slug, 'og-image.png'))) {
    err(`og-image missing for ${s.slug} (run node tools/generate.js)`);
  }
}

/* ---- 2. sitemap.xml URLs must match files ---- */
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const u of sitemapUrls) {
  const rel = u.replace(URL, '');
  const file = path.join(ROOT, rel.replace(/\/$/, '').replace(/^\//, '') || '.', 'index.html');
  if (rel.endsWith('/') && !fs.existsSync(file)) {
    err(`sitemap URL has no matching page: ${u}`);
  }
}
ok(`sitemap has ${sitemapUrls.length} URL(s)`);

/* ---- 3. robots.txt must reference sitemap ---- */
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
if (!robots.includes('Sitemap: ' + URL + '/sitemap.xml')) err('robots.txt missing sitemap reference');
else ok('robots.txt references sitemap');

/* ---- 4. HTML checks ---- */
const pages = [path.join(ROOT, 'index.html'), ...slugs.map((s) => path.join(ROOT, 'simulators', s, 'index.html'))];
const titles = new Map();
for (const p of pages) {
  const html = fs.readFileSync(p, 'utf8');
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (!t) err(`${rel}: missing <title>`);
  else if (titles.has(t)) err(`duplicate <title>: "${t}" (${titles.get(t)} and ${rel})`);
  else titles.set(t, rel);
  const desc = (html.match(/name="description" content="([^"]*)"/) || [])[1];
  if (!desc) err(`${rel}: missing meta description`);
  if (!html.includes('<html lang="en"')) err(`${rel}: missing lang attribute`);
  if (!html.includes('"@context"')) err(`${rel}: missing JSON-LD`);
  if (!html.includes('https://www.googletagmanager.com/gtag/js?id=G-KZNSWN38MR')) {
    err(`${rel}: missing GA tag`);
  }
  for (const ld of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const obj = JSON.parse(ld[1]);
      if (!obj['@context']) err(`${rel}: JSON-LD block missing @context`);
      else ok(`${rel}: JSON-LD parses`);
    } catch (e) {
      err(`${rel}: JSON-LD invalid: ${e.message}`);
    }
  }
  if (!html.includes('<meta name="robots" content="index, follow"')) err(`${rel}: missing robots meta`);

  /* internal href checks */
  for (const href of html.matchAll(/href="([^"#][^"]*)"/g)) {
    const target = href[1];
    if (/^https?:|^mailto:|^data:/i.test(target)) continue;
    let file = path.join(path.dirname(p), target.replace(/\/$/, ''));
    if (!path.extname(file)) file += '/index.html';
    if (!fs.existsSync(file)) err(`${rel}: broken internal link href="${target}"`);
  }
}

/* ---- 5. duplicate meta descriptions ---- */
const descs = new Map();
for (const p of pages) {
  const html = fs.readFileSync(p, 'utf8');
  const d = (html.match(/name="description" content="([^"]*)"/) || [])[1];
  if (!d) continue;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  if (descs.has(d)) err(`duplicate meta description (${descs.get(d)} and ${rel})`);
  else descs.set(d, rel);
}

/* ---- 6. webmanifest / favicon presence ---- */
for (const f of ['site.webmanifest', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'og-image.png', 'rss.xml', 'llms.txt']) {
  if (!fs.existsSync(path.join(ROOT, f))) err(`missing root asset: ${f}`);
  else ok(`present: ${f}`);
}
if (fs.existsSync(path.join(ROOT, 'site.webmanifest'))) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, 'site.webmanifest'), 'utf8')); ok('site.webmanifest parses'); }
  catch (e) { err('site.webmanifest invalid: ' + e.message); }
}

/* ---- 7. rss/llms generated from current manifest ---- */
const rss = fs.readFileSync(path.join(ROOT, 'rss.xml'), 'utf8');
for (const s of manifest.simulators || []) {
  if (!rss.includes(URL + '/simulators/' + s.slug + '/')) err(`rss.xml missing item for ${s.slug}`);
}
const llms = fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8');
for (const s of manifest.simulators || []) {
  if (!llms.includes(URL + '/simulators/' + s.slug + '/')) err(`llms.txt missing entry for ${s.slug}`);
}

/* ---- report ---- */
console.log('\n== RESULT ==');
if (errors.length) {
  console.log(errors.map((e) => 'ERROR: ' + e).join('\n'));
  console.log(`\n${errors.length} problem(s) found. Re-run \`node tools/generate.js\` after fixing.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
