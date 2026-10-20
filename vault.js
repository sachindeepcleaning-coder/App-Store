window.Vault = (function () {
  'use strict';

  var CONFIG = window.STORE_CONFIG || {};
  var REMEMBER_KEY = 'sasin-appstore-remember';
  var TOKEN_KEY = 'sasin-appstore-token';
  var TOKEN_EXPIRES_KEY = 'sasin-appstore-token-expires';
  var DEFAULT_URL = 'https://app-store.sachindeepcleaning.workers.dev';
  var MAX_WORKER_UPLOAD = 95 * 1024 * 1024;

  function workerUrl() {
    return String(CONFIG.workerUrl || DEFAULT_URL).replace(/\/+$/, '');
  }

  function rememberToken() {
    try { return window.localStorage.getItem(REMEMBER_KEY) || ''; } catch (e) { return ''; }
  }

  function setRememberToken(value) {
    try {
      if (value) window.localStorage.setItem(REMEMBER_KEY, value);
      else window.localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* ignore */ }
  }

  function sessionToken() {
    try {
      var stored = window.sessionStorage.getItem(TOKEN_KEY) || '';
      var expires = Number(window.sessionStorage.getItem(TOKEN_EXPIRES_KEY) || 0);
      if (stored && expires > Date.now()) return stored;
    } catch (e) { /* ignore */ }
    return '';
  }

  function setSessionToken(value, expires) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, value || '');
      window.sessionStorage.setItem(TOKEN_EXPIRES_KEY, String(expires || 0));
    } catch (e) { /* ignore */ }
  }

  function clearSessionToken() {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(TOKEN_EXPIRES_KEY);
    } catch (e) { /* ignore */ }
  }

  function request(path, options) {
    var opts = options || {};
    var headers = {};
    var body = opts.body;

    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    if (opts.meta) {
      headers['x-app-meta'] = JSON.stringify(opts.meta);
    }
    if (opts.token) {
      headers['x-store-token'] = opts.token;
    }
    if (opts.rawContentType) {
      headers['Content-Type'] = opts.rawContentType;
    }

    return window.fetch(workerUrl() + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
        }
        if (!res.ok) {
          var err = new Error(data.error || ('Request failed with ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function unlock(pass) {
    return request('/session', { method: 'POST', json: { password: pass } }).then(function (data) {
      setSessionToken(data.token, data.expires);
      return data;
    });
  }

  function remember(pass) {
    return request('/remember', { method: 'POST', json: { password: pass } }).then(function (data) {
      setRememberToken(data.token);
      return data;
    });
  }

  function isUnlocked() {
    return !!(sessionToken() || rememberToken());
  }

  function ensureToken() {
    var session = sessionToken();
    if (session) return Promise.resolve(session);
    var remembered = rememberToken();
    if (remembered) return Promise.resolve(remembered);
    return Promise.reject(new Error('Unlock the private store first.'));
  }

  function catalogue() {
    return ensureToken().then(function (tok) {
      return request('/catalogue', { token: tok });
    }).then(function (data) {
      return Array.isArray(data.apps) ? data.apps : [];
    });
  }

  function upload(meta, file) {
    return ensureToken().then(function (tok) {
      return request('/upload', {
        method: 'POST',
        token: tok,
        meta: meta,
        rawContentType: file.type || 'application/octet-stream',
        body: file
      });
    });
  }

  function createRelease(meta) {
    return ensureToken().then(function (tok) {
      return request('/release', { method: 'POST', token: tok, meta: meta });
    });
  }

  function recordEntry(entry) {
    return ensureToken().then(function (tok) {
      return request('/catalogue', { method: 'POST', token: tok, json: { entry: entry } });
    });
  }

  function uploadLarge(meta, file, githubToken, onProgress) {
    return createRelease(meta).then(function (release) {
      if (onProgress) onProgress('Uploading ' + file.name + ' directly to GitHub');
      return file.arrayBuffer().then(function (buffer) {
        return window.fetch(
          'https://uploads.github.com/repos/' +
            (meta.owner || 'sachindeepcleaning-coder') + '/' +
            (meta.repo || 'my-apps') + '/releases/' +
            release.releaseId + '/assets?name=' + encodeURIComponent(release.fileName),
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + githubToken,
              'Content-Type': 'application/octet-stream',
              'X-GitHub-Api-Version': '2022-11-28'
            },
            body: buffer
          }
        ).then(function (res) {
          return res.text().then(function (text) {
            var data = {};
            try { data = JSON.parse(text); } catch (e) { data = {}; }
            if (!res.ok) {
              throw new Error(data.message || ('GitHub rejected the upload (' + res.status + ')'));
            }
            return data;
          });
        });
      }).then(function (asset) {
        var entry = {
          id: meta.id,
          name: meta.name,
          developer: meta.developer,
          category: meta.category,
          version: meta.version,
          size: meta.size,
          sizeBytes: file.size,
          description: meta.description,
          fileName: asset.name || release.fileName,
          releaseId: release.releaseId,
          assetId: asset.id,
          updated: new Date().toISOString().slice(0, 10),
          featured: !!meta.featured,
          source: 'private'
        };
        return recordEntry(entry).then(function () { return entry; });
      });
    });
  }

  function ticket(id) {
    return ensureToken().then(function (tok) {
      return request('/ticket/' + encodeURIComponent(id), { method: 'POST', token: tok });
    });
  }

  function share(id, options) {
    var opts = options || {};
    return ensureToken().then(function (tok) {
      return request('/share', {
        method: 'POST',
        token: tok,
        json: { id: id, rotate: !!opts.rotate, expiresInDays: opts.expiresInDays || 0 }
      });
    });
  }

  function revokeShare(shareId) {
    return ensureToken().then(function (tok) {
      return request('/share/' + encodeURIComponent(shareId), { method: 'DELETE', token: tok });
    });
  }

  function remove(id) {
    return ensureToken().then(function (tok) {
      return request('/file/' + encodeURIComponent(id), { method: 'DELETE', token: tok });
    });
  }

  function shareUrl(shareId) {
    return shareId ? (workerUrl() + '/share/' + shareId) : '';
  }

  function lock() {
    clearSessionToken();
    setRememberToken('');
  }

  return {
    workerUrl: workerUrl,
    rememberToken: rememberToken,
    setRememberToken: setRememberToken,
    sessionToken: sessionToken,
    unlock: unlock,
    remember: remember,
    isUnlocked: isUnlocked,
    lock: lock,
    catalogue: catalogue,
    upload: upload,
    uploadLarge: uploadLarge,
    ticket: ticket,
    share: share,
    revokeShare: revokeShare,
    shareUrl: shareUrl,
    remove: remove,
    maxWorkerUpload: MAX_WORKER_UPLOAD
  };
})();
