const GITHUB_API = 'https://api.github.com';
const GITHUB_UPLOAD = 'https://uploads.github.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-store-token, x-app-meta'
};

const MAX_WORKER_UPLOAD = 95 * 1024 * 1024;
const SESSION_TTL = 60 * 60 * 1000;
const TICKET_TTL = 15 * 60 * 1000;
const CATALOGUE_FILE = 'catalogue.json';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
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
  if (payload !== undefined && tokenPayload !== payload) return false;
  const expected = await hmacHex(env.TOKEN_SECRET, `${expiryRaw}.${tokenPayload}`);
  return constantTimeEqual(expected, sig);
}

async function checkPassword(env, password) {
  if (!env.STORE_PASSWORD) return false;
  const given = String(password || '');
  const expected = String(env.STORE_PASSWORD);
  if (given.length !== expected.length) return false;
  return constantTimeEqual(given, expected);
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
  return ghJson(env, repoPath(env, `/contents/${CATALOGUE_FILE}`), { method: 'PUT', body });
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'app';
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
  headers.set('Content-Disposition', `attachment; filename="${(entry.fileName || entry.file || 'download').replace(/"/g, '')}"`);
  const length = res.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  headers.set('Cache-Control', 'private, no-store');
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
        return json({
          ok: true,
          service: 'sachin-app-store',
          repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
          maxWorkerUpload: MAX_WORKER_UPLOAD,
          requires: ['session', 'upload', 'file', 'share']
        });
      }

      if (url.pathname === '/catalogue' && request.method === 'GET') {
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
        let body = {};
        try { body = await request.json(); } catch (e) { body = {}; }
        if (!(await checkPassword(env, body.password))) {
          return fail('Incorrect password.', 401);
        }
        const token = await signToken(env, 'session', SESSION_TTL);
        return json({ ok: true, token, expires: Date.now() + SESSION_TTL });
      }

      if (url.pathname === '/upload' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
          return fail('Your session has expired. Unlock the store again.', 401);
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
        const fileName = String(meta.fileName || `${id}-${version}.bin`).replace(/[^\w.\- ]/g, '_');
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
        next.push(entry);
        next.__sha = sha;
        await writeCatalogue(env, next);

        return json({ ok: true, app: entry });
      }

      if (url.pathname === '/release' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
          return fail('Your session has expired. Unlock the store again.', 401);
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
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        let payload = {};
        try { payload = await request.json(); } catch (e) { payload = {}; }
        if (!payload.entry || !payload.entry.id) return fail('Missing app entry.', 400);

        const { items, sha } = await readCatalogue(env);
        const next = items.filter((item) => item.id !== payload.entry.id);
        next.push(payload.entry);
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({ ok: true, app: payload.entry });
      }

      if (url.pathname === '/share' && request.method === 'POST') {
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
          return fail('Your session has expired. Unlock the store again.', 401);
        }
        let payload = {};
        try { payload = await request.json(); } catch (e) { payload = {}; }
        const { items, entry, sha } = await findById(env, payload.id);
        if (!entry) return fail('That app is not in the catalogue.', 404);

        const shareId = payload.rotate || !entry.shareId ? randomId(12) : entry.shareId;
        entry.shareId = shareId;
        const next = items.filter((item) => item.id !== entry.id);
        next.push(entry);
        next.__sha = sha;
        await writeCatalogue(env, next);
        return json({ ok: true, shareId, url: `${url.origin}/share/${shareId}` });
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
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
          return fail('Your session has expired. Unlock the store again.', 401);
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
        return streamAsset(env, entry);
      }

      if (url.pathname.startsWith('/file/') && request.method === 'DELETE') {
        if (!(await verifyToken(env, tokenHeader, 'session'))) {
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
