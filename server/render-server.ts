import express, { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PostProps } from '../src/schema';
import { assertPublicUrl } from './net';
import { resolveMedia } from './resolve';

const PORT = Number(process.env.PORT ?? 3005);
const TOKEN = process.env.RENDER_TOKEN ?? '';
const PUBLIC_BASE = (() => {
  const raw = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
})();
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_MB ?? 200) * 1024 * 1024;
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS ?? 24);
const ROOT = path.resolve(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'data', 'media');
const OUT_DIR = path.join(ROOT, 'data', 'out');

if (!TOKEN || TOKEN.length < 24) {
  console.error('RENDER_TOKEN must be set (>= 24 chars).');
  process.exit(1);
}

// ---------- media download (size + time limited) ----------
const download = async (raw: string): Promise<{ file: string; contentType: string }> => {
  // Follow up to 5 redirects manually, re-validating every hop against the SSRF guard.
  let url = await assertPublicUrl(raw);
  let res: globalThis.Response | undefined;
  for (let hop = 0; hop <= 5; hop++) {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new Error(`Media fetch failed: HTTP ${res?.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_MEDIA_BYTES) throw new Error('Media too large');
  const contentType = res.headers.get('content-type') ?? '';
  const ext = contentType.includes('video') ? '.mp4' : contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const file = path.join(MEDIA_DIR, `${randomUUID()}${ext}`);
  let received = 0;
  const body = Readable.fromWeb(res.body as any);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_MEDIA_BYTES) body.destroy(new Error('Media too large'));
  });
  await pipeline(body, createWriteStream(file));
  return { file, contentType };
};

// ---------- video dimensions via ffprobe (stable across Remotion versions) ----------
const execFileP = promisify(execFile);
const probeVideo = async (file: string): Promise<{ width: number; height: number }> => {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file,
  ], { timeout: 30_000 });
  const s = JSON.parse(stdout)?.streams?.[0];
  if (!s?.width || !s?.height) throw new Error('Unreadable video');
  return { width: Number(s.width), height: Number(s.height) };
};

// ---------- render queue (one job at a time to protect RAM) ----------
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

type RenderRequest = Omit<PostProps, 'mediaWidth' | 'mediaHeight' | 'mediaType'> & {
  type: 'still' | 'video';
};

const validate = (b: any): RenderRequest => {
  if (!b || typeof b !== 'object') throw new Error('Invalid body');
  if (b.type !== 'still' && b.type !== 'video') throw new Error('type must be "still" or "video"');
  if (typeof b.media !== 'string' || b.media.length > 2048) throw new Error('media URL required');
  if (typeof b.headline !== 'string' || !b.headline.trim() || b.headline.length > 160) {
    throw new Error('headline required (<= 160 chars)');
  }
  if (b.badge !== undefined && (typeof b.badge !== 'string' || b.badge.length > 24)) throw new Error('badge <= 24 chars');
  const pct = (v: unknown) => (v === undefined ? 50 : Math.min(100, Math.max(0, Number(v) || 0)));
  return {
    type: b.type,
    media: b.media,
    headline: b.headline.trim(),
    badge: b.badge?.trim() || undefined,
    focalX: pct(b.focalX),
    focalY: pct(b.focalY),
    fit: ['cover', 'contain'].includes(b.fit) ? b.fit : 'auto',
    startSec: Math.max(0, Number(b.startSec) || 0),
    durationSec: Math.min(90, Math.max(3, Number(b.durationSec) || 15)),
    voiceover: typeof b.voiceover === 'string' ? b.voiceover : undefined,
  };
};

const auth = (req: Request, res: Response, next: NextFunction) => {
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(TOKEN);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
};

const cleanup = async () => {
  const cutoff = Date.now() - RETENTION_HOURS * 3600_000;
  for (const dir of [MEDIA_DIR, OUT_DIR]) {
    for (const f of await fs.readdir(dir)) {
      const p = path.join(dir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.rm(p, { force: true });
    }
  }
};

const main = async () => {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log('Bundling Remotion project…');
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts') });
  console.log('Bundle ready.');

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  // Remotion's headless browser reads downloaded media from here (localhost only).
  app.use('/media', (req, res, next) => {
    const ip = req.socket.remoteAddress ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(403).end();
    next();
  }, express.static(MEDIA_DIR, { fallthrough: false }));
  app.use('/out', express.static(OUT_DIR, { fallthrough: false }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Find the best image (and any demo video) for a project/page URL.
  app.post('/resolve-media', auth, async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!/^https?:\/\//i.test(url) || url.length > 2048) return res.status(400).json({ error: 'url required' });
    try {
      res.json(await resolveMedia(url));
    } catch (e: any) {
      console.error(e);
      res.status(422).json({ error: e.message ?? 'resolve failed' });
    }
  });

  app.post('/render', auth, async (req, res) => {
    let input: RenderRequest;
    try {
      input = validate(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    try {
      const result = await enqueue(async () => {
        const { file, contentType } = await download(input.media);
        const isVideo = input.type === 'video' || contentType.includes('video');
        const localUrl = `http://127.0.0.1:${PORT}/media/${path.basename(file)}`;

        let mediaWidth: number;
        let mediaHeight: number;
        if (isVideo) {
          const meta = await probeVideo(file);
          mediaWidth = meta.width;
          mediaHeight = meta.height;
        } else {
          const meta = await sharp(file).metadata();
          if (!meta.width || !meta.height) throw new Error('Unreadable image');
          mediaWidth = meta.width;
          mediaHeight = meta.height;
        }

        let voiceoverUrl: string | undefined;
        if (input.type === 'video' && input.voiceover) {
          const vo = await download(input.voiceover);
          voiceoverUrl = `http://127.0.0.1:${PORT}/media/${path.basename(vo.file)}`;
        }

        const inputProps: PostProps = {
          media: localUrl,
          mediaType: isVideo ? 'video' : 'image',
          mediaWidth,
          mediaHeight,
          headline: input.headline,
          badge: input.badge,
          focalX: input.focalX,
          focalY: input.focalY,
          fit: input.fit,
          startSec: input.startSec,
          durationSec: input.durationSec,
          voiceover: voiceoverUrl,
        };

        const id = randomUUID();
        if (input.type === 'still') {
          // For a video source, a still uses its first frame (pass a frame image for best results).
          const composition = await selectComposition({ serveUrl, id: 'Post', inputProps });
          const output = path.join(OUT_DIR, `${id}.png`);
          await renderStill({ composition, serveUrl, output, inputProps, imageFormat: 'png' });
          return { id, url: `${PUBLIC_BASE}/out/${id}.png`, mediaWidth, mediaHeight };
        }

        const composition = await selectComposition({ serveUrl, id: 'PostVideo', inputProps });
        const outputLocation = path.join(OUT_DIR, `${id}.mp4`);
        await renderMedia({
          composition,
          serveUrl,
          codec: 'h264',
          outputLocation,
          inputProps,
          crf: 20,
          concurrency: Number(process.env.RENDER_CONCURRENCY ?? 2),
        });
        return { id, url: `${PUBLIC_BASE}/out/${id}.mp4`, mediaWidth, mediaHeight };
      });

      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(422).json({ error: e.message ?? 'render failed' });
    }
  });

  setInterval(() => cleanup().catch(console.error), 3600_000);
  app.listen(PORT, () => console.log(`HAZ render server on :${PORT}`));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
