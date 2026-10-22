import sharp from 'sharp';
import { safeFetch } from './net';

// ======================================================================
// Pure parsers (unit-tested without network)
// ======================================================================

export type Candidate = { url: string; kind: 'image' | 'video' | 'asset'; from: string };

const BADGE_HOSTS = /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|travis-ci\.(org|com)|circleci\.com|codecov\.io|coveralls\.io|deepwiki\.com|star-history\.com|contrib\.rocks|komarev\.com|visitor-badge|hits\.seeyoufarm\.com|img\.buymeacoffee\.com|ko-fi\.com|trendshift\.io|producthunt\.com|readme-typing-svg|github-readme-stats|api\.netlify\.com|discordapp\.com|discord\.com)$/i;
const BADGE_PATH = /(badge|shield|\/workflows\/[^/]+\/badge|logo|icon|favicon|avatar|sponsor|button|banner-small|star-history)/i;

export const isLikelyBadge = (u: string): boolean => {
  try {
    const x = new URL(u);
    if (BADGE_HOSTS.test(x.hostname)) return true;
    if (/\.svg(\?|$)/i.test(x.pathname)) return true;
    return BADGE_PATH.test(x.pathname);
  } catch {
    return true;
  }
};

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;

export type RepoCtx =
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'hf'; prefix: '' | 'spaces/' | 'datasets/'; owner: string; name: string };

/** Turn a README-relative or blob URL into a directly fetchable URL. */
export const absolutize = (raw: string, ctx: RepoCtx | null, base?: string): string | null => {
  const s = raw.trim().replace(/^<|>$/g, '');
  if (!s || s.startsWith('data:') || s.startsWith('#') || s.startsWith('mailto:')) return null;
  if (/^https?:\/\//i.test(s)) {
    // github.com/o/r/blob/<ref>/<path>  ->  raw.githubusercontent.com/o/r/<ref>/<path>
    const blob = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i);
    if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3].replace(/\?raw=true$/i, '')}`;
    return s;
  }
  if (s.startsWith('//')) return `https:${s}`;
  const clean = s.replace(/^\.\//, '').replace(/^\//, '');
  if (ctx?.kind === 'github') return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/HEAD/${clean}`;
  if (ctx?.kind === 'hf') return `https://huggingface.co/${ctx.prefix}${ctx.owner}/${ctx.name}/resolve/main/${clean}`;
  if (base) {
    try { return new URL(s, base).toString(); } catch { return null; }
  }
  return null;
};

/** Images / videos referenced in a README (markdown + inline HTML), in document order. */
export const parseReadmeMedia = (md: string, ctx: RepoCtx | null): Candidate[] => {
  const found: { idx: number; raw: string; hint: Candidate['kind'] }[] = [];
  const push = (re: RegExp, hint: Candidate['kind']) => {
    for (const m of md.matchAll(re)) found.push({ idx: m.index ?? 0, raw: m[1], hint });
  };
  push(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, 'image');
  push(/<img[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, 'image');
  push(/<video[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, 'video');
  push(/<source[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, 'video');
  // GitHub drag-and-drop uploads appear as bare URLs on their own line (often videos).
  push(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36})\s*$/gim, 'asset');
  push(/^\s*(https:\/\/[^\s]+\.(?:mp4|webm|mov))\s*$/gim, 'video');

  found.sort((a, b) => a.idx - b.idx);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const url = absolutize(f.raw, ctx);
    if (!url || seen.has(url) || isLikelyBadge(url)) continue;
    seen.add(url);
    const kind: Candidate['kind'] = VIDEO_EXT.test(url) ? 'video' : IMAGE_EXT.test(url) ? 'image' : f.hint;
    out.push({ url, kind, from: 'readme' });
  }
  return out;
};

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const metaContent = (html: string, keys: string[]): string | null => {
  for (const key of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${key}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m) return decodeEntities(m[1].trim());
  }
  return null;
};

export const parseHtmlMeta = (html: string, base: string) => {
  const head = html.slice(0, 300_000);
  const img = metaContent(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const video = metaContent(head, ['og:video:secure_url', 'og:video:url', 'og:video']);
  const title = metaContent(head, ['og:title', 'twitter:title']) ?? head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  const description = metaContent(head, ['og:description', 'description', 'twitter:description']);
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const abs = (u: string | null) => (u ? absolutize(u, null, base) : null);
  return {
    image: abs(img),
    video: abs(video),
    title: title ? decodeEntities(title) : null,
    description,
    text: decodeEntities(body).replace(/\s+/g, ' ').trim().slice(0, 3500),
  };
};

/** Plain-text excerpt of a README for the writer (no badges, images, HTML or code). */
export const readmeText = (md: string, max = 3500): string =>
  md
    .replace(/^---\n[\s\S]*?\n---\n/, '')          // HF YAML front matter
    .replace(/```[\s\S]*?```/g, ' ')                 // code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
    .replace(/<[^>]+>/g, ' ')                         // html
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // links -> text
    .replace(/https?:\/\/\S+/g, ' ')                  // bare urls
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);

export const detectRepo = (u: string): RepoCtx | null => {
  const gh = u.match(/^https?:\/\/(?:www\.)?github\.com\/([^/#?]+)\/([^/#?]+)/i);
  if (gh && !['orgs', 'topics', 'sponsors', 'user-attachments'].includes(gh[1].toLowerCase())) {
    return { kind: 'github', owner: gh[1], repo: gh[2].replace(/\.git$/i, '') };
  }
  const hf = u.match(/^https?:\/\/(?:www\.)?huggingface\.co\/(spaces\/|datasets\/)?([^/#?]+)\/([^/#?]+)/i);
  if (hf && hf[2] !== 'papers' && hf[2] !== 'api') {
    return { kind: 'hf', prefix: (hf[1]?.toLowerCase() ?? '') as '' | 'spaces/' | 'datasets/', owner: hf[2], name: hf[3] };
  }
  return null;
};

// ======================================================================
// Network resolution
// ======================================================================

type ResolvedImage = { url: string; width: number; height: number; from: string };
export type ResolveResult = {
  image: ResolvedImage | null;
  video: { url: string; from: string } | null;
  title: string | null;
  text: string;
  tried: { url: string; reason: string }[];
};

const MIN_W = 500;
const MIN_H = 250;

const checkImage = async (c: Candidate, tried: ResolveResult['tried']): Promise<ResolvedImage | null> => {
  try {
    const r = await safeFetch(c.url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 20_000 });
    if (r.status >= 400 || !r.body) { tried.push({ url: c.url, reason: `http ${r.status}` }); return null; }
    if (!r.contentType.startsWith('image/') || r.contentType.includes('svg')) {
      tried.push({ url: c.url, reason: `type ${r.contentType || 'unknown'}` }); return null;
    }
    const meta = await sharp(r.body, { animated: false }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const ratio = w / Math.max(h, 1);
    if (w < MIN_W || h < MIN_H) { tried.push({ url: c.url, reason: `small ${w}x${h}` }); return null; }
    if (ratio > 3.2 || ratio < 0.4) { tried.push({ url: c.url, reason: `ratio ${ratio.toFixed(2)}` }); return null; }
    return { url: r.finalUrl, width: w, height: h, from: c.from };
  } catch (e: any) {
    tried.push({ url: c.url, reason: String(e?.message ?? e).slice(0, 80) });
    return null;
  }
};

const fetchText = async (url: string, headers?: Record<string, string>): Promise<string | null> => {
  try {
    const r = await safeFetch(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000, headers });
    if (r.status >= 400 || !r.body) return null;
    return r.body.toString('utf8');
  } catch {
    return null;
  }
};

export const resolveMedia = async (pageUrl: string): Promise<ResolveResult> => {
  const tried: ResolveResult['tried'] = [];
  const ctx = detectRepo(pageUrl);
  let candidates: Candidate[] = [];
  let fallbacks: Candidate[] = [];
  let text = '';
  let title: string | null = null;

  if (ctx?.kind === 'github') {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.raw' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const md = await fetchText(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/readme`, headers);
    if (md) {
      candidates = parseReadmeMedia(md, ctx);
      text = readmeText(md);
    }
    title = `${ctx.owner}/${ctx.repo}`;
    fallbacks = [{ url: `https://opengraph.githubassets.com/1/${ctx.owner}/${ctx.repo}`, kind: 'image', from: 'github-og' }];
  } else if (ctx?.kind === 'hf') {
    const md = await fetchText(`https://huggingface.co/${ctx.prefix}${ctx.owner}/${ctx.name}/raw/main/README.md`);
    if (md) {
      candidates = parseReadmeMedia(md, ctx);
      text = readmeText(md);
      const thumb = md.match(/^thumbnail:\s*["']?(\S+?)["']?\s*$/m)?.[1];
      if (thumb) candidates.unshift({ url: absolutize(thumb, ctx) ?? thumb, kind: 'image', from: 'hf-thumbnail' });
    }
    title = `${ctx.owner}/${ctx.name}`;
    const section = ctx.prefix === 'spaces/' ? 'spaces' : ctx.prefix === 'datasets/' ? 'datasets' : 'models';
    fallbacks = [{ url: `https://cdn-thumbnails.huggingface.co/social-thumbnails/${section}/${ctx.owner}/${ctx.name}.png`, kind: 'image', from: 'hf-og' }];
  }

  // Generic page (also used for HF papers and any product site): og:image + text.
  if (!ctx || candidates.length === 0 || !text) {
    const html = await fetchText(pageUrl);
    if (html) {
      const meta = parseHtmlMeta(html, pageUrl);
      title = title ?? meta.title;
      if (!text) text = [meta.description, meta.text].filter(Boolean).join('\n').slice(0, 3500);
      if (meta.video) candidates.push({ url: meta.video, kind: 'video', from: 'og-video' });
      if (meta.image && !isLikelyBadge(meta.image)) fallbacks.unshift({ url: meta.image, kind: 'image', from: 'og-image' });
    }
  }

  // Classify GitHub upload assets (image or video) by content-type without downloading them.
  for (const c of candidates.filter((x) => x.kind === 'asset').slice(0, 4)) {
    try {
      const r = await safeFetch(c.url, { peekOnly: true, timeoutMs: 10_000 });
      c.kind = r.contentType.startsWith('video/') ? 'video' : r.contentType.startsWith('image/') ? 'image' : 'asset';
      if (c.kind === 'video') c.url = r.finalUrl;
    } catch { /* leave as asset */ }
  }

  const videoCand = candidates.find((c) => c.kind === 'video') ?? null;
  const imageCands = [...candidates.filter((c) => c.kind === 'image'), ...fallbacks].slice(0, 8);

  let image: ResolvedImage | null = null;
  for (const c of imageCands) {
    image = await checkImage(c, tried);
    if (image) break;
  }

  return {
    image,
    video: videoCand ? { url: videoCand.url, from: videoCand.from } : null,
    title,
    text,
    tried,
  };
};
