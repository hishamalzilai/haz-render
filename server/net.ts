import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// ---------- SSRF guard: only public http(s) hosts ----------
export const isPrivateIp = (ip: string): boolean => {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

export const assertPublicUrl = async (raw: string): Promise<URL> => {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed');
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('Host resolves to a private address');
  }
  return url;
};

export type SafeResponse = {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer | null; // null when peekOnly
};

/**
 * fetch with SSRF re-validation on every redirect, a byte cap and a timeout.
 * peekOnly: read headers only (no body) — used to classify unknown asset URLs.
 */
export const safeFetch = async (
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; peekOnly?: boolean } = {},
): Promise<SafeResponse> => {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let url = await assertPublicUrl(raw);
  let res: Response | undefined;
  for (let hop = 0; hop <= 5; hop++) {
    res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'haz-render/1.0 (+media resolver)', ...(opts.headers ?? {}) },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => undefined);
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res) throw new Error('No response');
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (opts.peekOnly || !res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status, finalUrl: url.toString(), contentType, body: null };
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await res.body.cancel().catch(() => undefined);
    throw new Error(`Too large (${declared} bytes)`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Too large (> ${maxBytes} bytes)`);
    }
    chunks.push(Buffer.from(value));
  }
  return { status: res.status, finalUrl: url.toString(), contentType, body: Buffer.concat(chunks) };
};
