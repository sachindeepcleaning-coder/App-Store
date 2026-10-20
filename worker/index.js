const GITHUB_API = 'https://api.github.com';
const GITHUB_UPLOAD = 'https://uploads.github.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-store-token, x-app-meta'
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

const MAX_WORKER_UPLOAD = 95 * 1024 * 1024;
const SESSION_TTL = 60 * 60 * 1000;
const REMEMBER_TTL = 30 * 24 * 60 * 60 * 1000;
const TICKET_TTL = 15 * 60 * 1000;
const CATALOGUE_FILE = 'catalogue.json';
const AUTH_PAYLOADS = ['session', 'remember'];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY,
      ...CORS,
      ...extraHeaders
    }
  });
}

function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64decode(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signToken(env, payload, ttlMs) {
  const expiry = Date.now() + ttlMs;
  const body = `${expiry}.${payload}`;
  const sig = await hmacHex(env.TOKEN_SECRET, body);
  return `${expiry}.${payload}.${sig}`;
}

async function verifyToken(env, token, payload) {
  if (!token || !env.TOKEN_SECRET) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [expiryRaw, tokenPayload, sig] = parts;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  if (payload !== undefined) {
    const allowed = Array.isArray(payload) ? payload : [payload];
    if (allowed.indexOf(tokenPayload) === -1) return false;
  }
  const expected = await hmacHex(env.TOKEN_SECRET, `${expiryRaw}.${tokenPayload}`);
  return constantTimeEqual(expected, sig);
}

async function takeLimit(env, binding, key) {
  if (!env || !env[binding] || typeof env[binding].limit !== 'function') return true;
  try {
    const result = await env[binding].limit({ key: String(key || 'anon') });
    return !!result.success;
  } catch (e) {
    return true;
  }
}

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anon';
}

async function guardStub(env, request) {
  if (!env || !env.LOGIN_GUARD || typeof env.LOGIN_GUARD.idFromName !== 'function') return null;
  try {
    const id = env.LOGIN_GUARD.idFromName(String(clientKey(request)).slice(0, 64));
    return env.LOGIN_GUARD.get(id);
  } catch (e) {
    return null;
  }
}

async function guardCheck(env, request) {
  const stub = await guardStub(env, request);
  if (!stub) return { locked: false };
  try {
    const res = await stub.fetch('https://guard/check');
    const data = await res.json();
    return data && typeof data.locked === 'boolean' ? data : { locked: false };
  } catch (e) {
    return { locked: false };
  }
}

async function guardRecord(env, request, ok) {
  const stub = await guardStub(env, request);
  if (!stub) return;
  try {
    await stub.fetch('https://guard/record?ok=' + (ok ? 'true' : 'false'));
  } catch (e) {
    /* fail open on bookkeeping errors */
  }
}

async function checkPassword(env, password) {
  if (!env.STORE_PASSWORD) return false;
  const given = String(password || '');
  const expected = String(env.STORE_PASSWORD);
  if (given.length !== expected.length) return false;
  return constantTimeEqual(given, expected);
}

function passwordPolicy(env) {
  const min = parseInt(env.PASSWORD_MIN_LENGTH || '10', 10) || 10;
  const stored = String(env.STORE_PASSWORD || '');
  const weak = stored.length < min;
  return { min, weak, length: stored.length };
}

function ghHeaders(env, extra = {}) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sachin-app-store-worker',
    ...extra
  };
}

async function ghJson(env, path, options = {}) {
  const res = await fetch(GITHUB_API + path, {
    method: options.method || 'GET',
    headers: ghHeaders(env, options.headers || {}),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = {}; }
  }
  if (!res.ok) {
    const err = new Error(data.message || `GitHub responded with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function repoPath(env, suffix) {
  return `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${suffix}`;
}

async function readCatalogue(env) {
  try {
    const data = await ghJson(env, repoPath(env, `/contents/${CATALOGUE_FILE}`));
    const text = b64decode(String(data.content || '').replace(/\n/g, ''));
    const parsed = JSON.parse(text);
    return { items: Array.isArray(parsed) ? parsed : [], sha: data.sha };
  } catch (err) {
    if (err.status === 404) return { items: [], sha: null };
    throw err;
  }
}

async function writeCatalogue(env, items) {
  const body = {
    message: `Update app catalogue (${items.length} app${items.length === 1 ? '' : 's'})`,
    content: b64encode(JSON.stringify(items, null, 2)),
    branch: env.GITHUB_BRANCH || 'main'
  };
  let sha = items.__sha;
  if (!sha) {
    const existing = await readCatalogue(env);
    sha = existing.sha;
  }
  if (sha) body.sha = sha;

  try {
    return await ghJson(env, repoPath(env, `/contents/${CATALOGUE_FILE}`), { method: 'PUT', body });
  } catch (err) {
    const conflict = err && (err.status === 409 || err.status === 422);
    if (!conflict) throw err;
    const current = await readCatalogue(env);
    body.sha = current.sha;
    return ghJson(env, repoPath(env, `/contents/${CATALOGUE_FILE}`), { method: 'PUT', body });
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'app';
}

function safeFileName(value) {
  return String(value || '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'download';
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function randomId(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function mergeEntry(items, entry) {
  const existing = items.find((item) => item.id === entry.id);
  if (existing && existing.shareId && !entry.shareId) {
    entry.shareId = existing.shareId;
  }
  return entry;
}

async function findById(env, id) {
  const { items, sha } = await readCatalogue(env);
  return { items, sha, entry: items.find((item) => item.id === id) || null };
}

async function findByShareId(env, shareId) {
  const { items, sha } = await readCatalogue(env);
  return { items, sha, entry: items.find((item) => item.shareId && item.shareId === shareId) || null };
}

async function streamAsset(env, entry) {
  const res = await fetch(`${GITHUB_API}${repoPath(env, `/releases/assets/${entry.assetId}`)}`, {
    headers: ghHeaders(env, { 'Accept': 'application/octet-stream' })
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `GitHub responded with ${res.status}`;
    try { message = JSON.parse(text).message || message; } catch (e) { /* keep default */ }
    return new Response(message, { status: res.status === 404 ? 404 : 502 });
  }
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${safeFileName(entry.fileName || entry.file || 'download')}"`);
  const length = res.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  headers.set('Cache-Control', 'private, no-store');
  Object.keys(SECURITY).forEach((key) => headers.set(key, SECURITY[key]));
  return new Response(res.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const tokenHeader = request.headers.get('x-store-token') || '';

      if (url.pathname === '/' && request.method === 'GET') {
        const policy = passwordPolicy(env);
        return json({
          ok: true,
          service: 'sachin-app-store',
          repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
          maxWorkerUpload: MAX_WORKER_UPLOAD,
          passwordPolicy: { minLength: policy.min, currentLength: policy.length, acceptable: !policy.weak },
          requires: ['session', 'remember', 'upload', 'file', 'share']
        });
      }

      if (url.pathname === '/catalogue' && request.method === 'GET') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Unlock the store to see the catalogue.', 401);
        }
        const { items } = await readCatalogue(env);
        const publicView = items.map((item) => ({
          id: item.id,
          name: item.name,
          developer: item.developer,
          category: item.category,
          version: item.version,
          size: item.size,
          sizeBytes: item.sizeBytes,
          description: item.description,
          fileName: item.fileName,
          updated: item.updated,
          featured: item.featured,
          shareId: item.shareId || null,
          source: 'private'
        }));
        return json({ ok: true, apps: publicView });
      }

      if (url.pathname === '/session' && request.method === 'POST') {
        const guard = await guardCheck(env, request);
        if (guard.locked) {
          const wait = Math.max(1, Number(guard.retryAfter) || 60);
          const unit = wait < 60 ? 'second' : 'minute';
          const amount = wait < 60 ? wait : Math.ceil(wait / 60);
          return fail(`Too many failed attempts. Try again in ${amount} ${unit}${amount === 1 ? '' : 's'}.`, 429);
        }
        if (!(await takeLimit(env, 'LOGIN_LIMITER', clientKey(request)))) {
          return fail('Too many attempts. Wait a minute and try again.', 429);
        }
        const policy = passwordPolicy(env);
        if (policy.weak) {
          return fail('The store password is too short. Set a longer one with: npx wrangler secret put STORE_PASSWORD', 503);
        }
        let body = {};
        try { body = await request.json(); } catch (e) { body = {}; }
        const ok = await checkPassword(env, body.password);
        await guardRecord(env, request, ok);
        if (!ok) {
          return fail('Incorrect password.', 401);
        }
        const token = await signToken(env, 'session', SESSION_TTL);
        return json({ ok: true, token, expires: Date.now() + SESSION_TTL });
      }

      if (url.pathname === '/remember' && request.method === 'POST') {
        const guard = await guardCheck(env, request);
        if (guard.locked) {
          const wait = Math.max(1, Number(guard.retryAfter) || 60);
          const unit = wait < 60 ? 'second' : 'minute';
          const amount = wait < 60 ? wait : Math.ceil(wait / 60);
          return fail(`Too many failed attempts. Try again in ${amount} ${unit}${amount === 1 ? '' : 's'}.`, 429);
        }
        if (!(await takeLimit(env, 'LOGIN_LIMITER', clientKey(request)))) {
          return fail('Too many attempts. Wait a minute and try again.', 429);
        }
        const policy = passwordPolicy(env);
        if (policy.weak) {
          return fail('The store password is too short. Set a longer one with: npx wrangler secret put STORE_PASSWORD', 503);
        }
        let body = {};
        try { body = await request.json(); } catch (e) { body = {}; }
        const ok = await checkPassword(env, body.password);
        await guardRecord(env, request, ok);
        if (!ok) {
          return fail('Incorrect password.', 401);
        }
        const token = await signToken(env, 'remember', REMEMBER_TTL);
        return json({ ok: true, token, expires: Date.now() + REMEMBER_TTL });
      }

      if (url.pathname === '/upload' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        if (!(await takeLimit(env, 'WRITE_LIMITER', clientKey(request)))) {
          return fail('Too many requests. Slow down a moment and try again.', 429);
        }
        let meta = {};
        try { meta = JSON.parse(request.headers.get('x-app-meta') || '{}'); } catch (e) { meta = {}; }

        const body = await request.arrayBuffer();
        if (!body.byteLength) return fail('The uploaded file was empty.', 400);
        if (body.byteLength > MAX_WORKER_UPLOAD) {
          return fail('This file is too large for the private worker. Use the GitHub release upload instead.', 413, {
            tooLarge: true,
            maxWorkerUpload: MAX_WORKER_UPLOAD,
            size: body.byteLength
          });
        }

        const id = slugify(meta.id || meta.name);
        const version = String(meta.version || '1.0.0');
        const fileName = safeFileName(meta.fileName || `${id}-${version}.bin`);
        const tag = `${id}-v${version}-${Date.now()}`;

        const release = await ghJson(env, repoPath(env, '/releases'), {
          method: 'POST',
          body: {
            tag_name: tag,
            name: `${meta.name || id} ${version}`,
            body: meta.description || '',
            draft: false,
            prerelease: false
          }
        });

        const uploadRes = await fetch(
          `${GITHUB_UPLOAD}${repoPath(env, `/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`)}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
              'Content-Type': 'application/octet-stream',
              'User-Agent': 'sachin-app-store-worker'
            },
            body
          }
        );
        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          let message = `GitHub rejected the upload (${uploadRes.status})`;
          try { message = JSON.parse(text).message || message; } catch (e) { /* keep default */ }
          await ghJson(env, repoPath(env, `/releases/${release.id}`), { method: 'DELETE' }).catch(() => null);
          return fail(message, 502);
        }
        const asset = await uploadRes.json();

        const { items, sha } = await readCatalogue(env);
        const entry = {
          id,
          name: String(meta.name || id),
          developer: String(meta.developer || 'Sachin'),
          category: String(meta.category || 'Utilities'),
          version,
          size: formatSize(body.byteLength),
          sizeBytes: body.byteLength,
          description: String(meta.description || ''),
          fileName,
          releaseId: release.id,
          assetId: asset.id,
          updated: new Date().toISOString().slice(0, 10),
          featured: !!meta.featured,
          source: 'private'
        };

        const next = items.filter((item) => item.id !== id);
        next.push(mergeEntry(items, entry));
        next.__sha = sha;
        await writeCatalogue(env, next);

        return json({ ok: true, app: entry });
      }

      if (url.pathname === '/release' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        if (!(await takeLimit(env, 'WRITE_LIMITER', clientKey(request)))) {
          return fail('Too many requests. Slow down a moment and try again.', 429);
        }
        let meta = {};
        try { meta = JSON.parse(request.headers.get('x-app-meta') || '{}'); } catch (e) { meta = {}; }
        const id = slugify(meta.id || meta.name);
        const version = String(meta.version || '1.0.0');
        const tag = `${id}-v${version}-${Date.now()}`;
        const release = await ghJson(env, repoPath(env, '/releases'), {
          method: 'POST',
          body: {
            tag_name: tag,
            name: `${meta.name || id} ${version}`,
            body: meta.description || '',
            draft: false,
            prerelease: false
          }
        });
        return json({ ok: true, releaseId: release.id, tag, fileName: String(meta.fileName || `${id}-${version}.bin`) });
      }

      if (url.pathname === '/catalogue' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        if (!(await takeLimit(env, 'WRITE_LIMITER', clientKey(request)))) {
          return fail('Too many requests. Slow down a moment and try again.', 429);
        }
        let payload = {};
        try { payload = await request.json(); } catch (e) { payload = {}; }
        if (!payload.entry || !payload.entry.id) return fail('Missing app entry.', 400);
        if (payload.entry.fileName) payload.entry.fileName = safeFileName(payload.entry.fileName);
        if (payload.entry.id) payload.entry.id = slugify(payload.entry.id);

        const { items, sha } = await readCatalogue(env);
        const next = items.filter((item) => item.id !== payload.entry.id);
        next.push(mergeEntry(items, payload.entry));
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({ ok: true, app: payload.entry });
      }

      if (url.pathname === '/share' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        if (!(await takeLimit(env, 'WRITE_LIMITER', clientKey(request)))) {
          return fail('Too many requests. Slow down a moment and try again.', 429);
        }
        let payload = {};
        try { payload = await request.json(); } catch (e) { payload = {}; }
        const { items, entry, sha } = await findById(env, payload.id);
        if (!entry) return fail('That app is not in the catalogue.', 404);

        const shareId = payload.rotate || !entry.shareId ? randomId(12) : entry.shareId;
        entry.shareId = shareId;
        entry.shareExpires = null;
        if (payload.expiresInDays) {
          const days = Math.min(Math.max(parseInt(payload.expiresInDays, 10) || 0, 1), 365);
          entry.shareExpires = Date.now() + days * 24 * 60 * 60 * 1000;
        }
        const next = items.filter((item) => item.id !== entry.id);
        next.push(entry);
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({
          ok: true,
          shareId,
          url: `${url.origin}/share/${shareId}`,
          expires: entry.shareExpires || null
        });
      }

      if (url.pathname.startsWith('/share/') && request.method === 'DELETE') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        const shareId = decodeURIComponent(url.pathname.slice('/share/'.length));
        const { items, sha } = await readCatalogue(env);
        const target = items.find((item) => item.shareId && item.shareId === shareId);
        if (!target) return fail('That share link is not valid.', 404);
        delete target.shareId;
        delete target.shareExpires;
        const next = items.filter((item) => item.id !== target.id);
        next.push(target);
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({ ok: true, revoked: shareId });
      }

      if (url.pathname.startsWith('/file/') && request.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice('/file/'.length));
        const ticket = url.searchParams.get('t') || '';
        if (!(await verifyToken(env, ticket, `file:${id}`))) {
          return fail('That download link is invalid or has expired.', 401);
        }
        const { entry } = await findById(env, id);
        if (!entry) return fail('That app is not in the catalogue.', 404);
        return streamAsset(env, entry);
      }

      if (url.pathname.startsWith('/ticket/') && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        if (!(await takeLimit(env, 'WRITE_LIMITER', clientKey(request)))) {
          return fail('Too many requests. Slow down a moment and try again.', 429);
        }
        let payload = {};
        try { payload = await request.json(); } catch (e) { payload = {}; }
        const id = String(payload.id || decodeURIComponent(url.pathname.slice('/ticket/'.length)));
        if (!id) return fail('Missing app id.', 400);
        const { entry } = await findById(env, id);
        if (!entry) return fail('That app is not in the catalogue.', 404);
        const ticket = await signToken(env, `file:${id}`, TICKET_TTL);
        return json({ ok: true, ticket, url: `${url.origin}/file/${encodeURIComponent(id)}?t=${encodeURIComponent(ticket)}`, expires: Date.now() + TICKET_TTL });
      }

      if (url.pathname.startsWith('/share/') && request.method === 'GET') {
        const shareId = decodeURIComponent(url.pathname.slice('/share/'.length));
        const { entry } = await findByShareId(env, shareId);
        if (!entry) return fail('That share link is not valid.', 404);
        if (entry.shareExpires && Date.now() > Number(entry.shareExpires)) {
          return fail('That share link has expired.', 410);
        }
        return streamAsset(env, entry);
      }

      if (url.pathname.startsWith('/file/') && request.method === 'DELETE') {
        if (!(await verifyToken(env, tokenHeader, AUTH_PAYLOADS))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        const id = decodeURIComponent(url.pathname.slice('/file/'.length));
        const { items, entry, sha } = await findById(env, id);
        if (!entry) return fail('That app is not in the catalogue.', 404);
        if (entry.releaseId) {
          await ghJson(env, repoPath(env, `/releases/${entry.releaseId}`), { method: 'DELETE' }).catch(() => null);
        }
        const next = items.filter((item) => item.id !== id);
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({ ok: true, removed: id });
      }

      return fail('Unknown route.', 404);
    } catch (err) {
      return fail(err && err.message ? err.message : 'Something went wrong.', 500);
    }
  }
};

export class LoginGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  backoffFor(fails) {
    const free = parseInt(this.env.LOCKOUT_FREE_ATTEMPTS || '3', 10);
    const base = Number.isFinite(free) && free >= 0 ? free : 3;
    if (fails <= base) return 0;
    if (fails <= base + 2) return 10;
    if (fails <= base + 5) return 60;
    if (fails <= base + 9) return 300;
    return 900;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    let state = (await this.state.storage.get('lock')) || { fails: 0, blockedUntil: 0 };

    if (url.pathname === '/check') {
      const blockedUntil = Number(state.blockedUntil || 0);
      const locked = blockedUntil > now;
      return new Response(JSON.stringify({
        locked,
        retryAfter: locked ? Math.ceil((blockedUntil - now) / 1000) : 0
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const ok = url.searchParams.get('ok') === 'true';
    if (ok) {
      state = { fails: 0, blockedUntil: 0 };
    } else {
      state.fails = (Number(state.fails) || 0) + 1;
      const wait = this.backoffFor(state.fails);
      state.blockedUntil = wait ? now + wait * 1000 : 0;
    }
    await this.state.storage.put('lock', state);
    return new Response(JSON.stringify({
      ok,
      fails: state.fails,
      locked: Number(state.blockedUntil || 0) > Date.now()
    }), { headers: { 'Content-Type': 'application/json' } });
  }
}
