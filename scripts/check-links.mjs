#!/usr/bin/env node
// check-links.mjs — verify every clickable http(s) link and image in the given Markdown
// files actually resolves (no 404, no dead host). Ignores fenced/inline code (config
// snippets, clone commands and API endpoints are not clickable links) and localhost.
// Exits non-zero if any link is broken, so it can gate CI.
// Usage: node check-links.mjs <file.md> [more.md ...]
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node check-links.mjs <file.md> [...]'); process.exit(2); }

const stripCode = (t) => t
  .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
  .replace(/`[^`]*`/g, '');          // inline code
const URL_RE = /https?:\/\/[^\s"')<>\]*]+/g;               // note: excludes * so markdown **bold** URLs don't over-capture
const SKIP = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

const urls = new Map();               // url -> Set(basename of files it appears in)
for (const f of files) {
  let text;
  try { text = stripCode(readFileSync(f, 'utf8')); }
  catch (e) { console.error(`cannot read ${f}: ${e.message}`); process.exitCode = 1; continue; }
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:]+$/, '');                // trim trailing sentence punctuation
    if (SKIP.test(u)) continue;
    (urls.get(u) ?? urls.set(u, new Set()).get(u)).add(f.split('/').pop());
  }
}

const UA = 'Mozilla/5.0 (VibeCodeBlogger link-check)';
async function status(u) {
  const opts = { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) };
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(u, { method, ...opts });
      if (method === 'HEAD' && [403, 405, 501].includes(r.status)) continue;   // some hosts block HEAD
      return r.status;
    } catch (e) { if (method === 'GET') return `ERR ${e.cause?.code || e.code || e.message}`; }
  }
  return 'ERR';
}
// live = 2xx/3xx; 401/403 = exists but auth-gated (fine for API/base URLs) — not "broken".
const isOk = (s) => (typeof s === 'number') && ((s >= 200 && s < 400) || s === 401 || s === 403);

const results = await Promise.all([...urls.keys()].map(async (u) => ({ u, s: await status(u) })));
const broken = results.filter((r) => !isOk(r.s)).sort((a, b) => a.u.localeCompare(b.u));
for (const r of broken) console.log(`BROKEN ${String(r.s).padEnd(7)} ${r.u}   [${[...urls.get(r.u)].join(', ')}]`);
console.log(`\n${results.length} unique links · ${results.length - broken.length} OK · ${broken.length} BROKEN`);
process.exit(broken.length ? 1 : 0);
