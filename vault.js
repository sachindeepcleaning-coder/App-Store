window.Vault = (function () {
  'use strict';

  var CONFIG = window.STORE_CONFIG || {};
  var PASSWORD_KEY = CONFIG.passwordStorageKey || 'sasin-appstore-password';
  var TOKEN_KEY = 'sasin-appstore-token';
  var TOKEN_EXPIRES_KEY = 'sasin-appstore-token-expires';
  var DEFAULT_URL = 'https://app-store.sachin-cleaner.workers.dev';
  var MAX_WORKER_UPLOAD = 95 * 1024 * 1024;

  function workerUrl() {
    var stored = '';
    try { stored = window.localStorage.getItem('sasin-appstore-worker') || ''; } catch (e) { stored = ''; }
    return (stored || CONFIG.workerUrl || DEFAULT_URL).replace(/\/+$/, '');
  }

  function setWorkerUrl(url) {
    try { window.localStorage.setItem('sasin-appstore-worker', String(url || '').replace(/\/+$/, '')); } catch (e) { /* ignore */ }
  }

  function password() {
    try { return window.localStorage.getItem(PASSWORD_KEY) || ''; } catch (e) { return ''; }
  }

  function setPassword(value) {
    try {
      if (value) window.localStorage.setItem(PASSWORD_KEY, value);
      else window.localStorage.removeItem(PASSWORD_KEY);
    } catch (e) { /* ignore */ }
  }

  function token() {
    try {
      var stored = window.sessionStorage.getItem(TOKEN_KEY) || '';
      var expires = Number(window.sessionStorage.getItem(TOKEN_EXPIRES_KEY) || 0);
      if (stored && expires > Date.now()) return stored;
    } catch (e) { /* ignore */ }
    return '';
  }

  function setToken(value, expires) {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, value || '');
      window.sessionStorage.setItem(TOKEN_EXPIRES_KEY, String(expires || 0));
    } catch (e) { /* ignore */ }
  }

  function clearToken() {
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
      setPassword(pass);
      setToken(data.token, data.expires);
      return data;
    });
  }

  function isUnlocked() {
    return !!token();
  }

  function ensureToken() {
    if (token()) return Promise.resolve(token());
    var pass = password();
    if (!pass) {
      return Promise.reject(new Error('Unlock the private store first.'));
    }
    return unlock(pass).then(function () { return token(); });
  }

  function catalogue() {
    return request('/catalogue').then(function (data) {
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

  function share(id, rotate) {
    return ensureToken().then(function (tok) {
      return request('/share', { method: 'POST', token: tok, json: { id: id, rotate: !!rotate } });
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
    clearToken();
  }

  return {
    workerUrl: workerUrl,
    setWorkerUrl: setWorkerUrl,
    password: password,
    setPassword: setPassword,
    token: token,
    unlock: unlock,
    isUnlocked: isUnlocked,
    lock: lock,
    catalogue: catalogue,
    upload: upload,
    uploadLarge: uploadLarge,
    ticket: ticket,
    share: share,
    shareUrl: shareUrl,
    remove: remove,
    maxWorkerUpload: MAX_WORKER_UPLOAD
  };
})();
