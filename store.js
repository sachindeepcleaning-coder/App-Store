window.AppStore = (function () {
  'use strict';

  var DB_NAME = 'sachin-app-store';
  var DB_VERSION = 1;
  var STORE_NAME = 'apps';
  var TOKEN_KEY = 'sasin-appstore-token';
  var REPO_OWNER = 'sachindeepcleaning-coder';
  var REPO_NAME = 'App-Store';
  var REPO_BRANCH = 'main';
  var MAX_PUBLISH_BYTES = 90 * 1024 * 1024;

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('This browser cannot store files locally.'));
        return;
      }
      var req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open local storage.')); };
    });
  }

  function withStore(mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, mode);
        var result;
        try {
          result = run(tx.objectStore(STORE_NAME));
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = function () {
          db.close();
          resolve(result && result.result !== undefined ? result.result : result);
        };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('Storage was aborted.')); };
      });
    });
  }

  function listLocal() {
    return withStore('readonly', function (store) {
      return store.getAll();
    }).then(function (rows) {
      return rows || [];
    });
  }

  function putLocal(record) {
    return withStore('readwrite', function (store) {
      store.put(record);
      return record;
    });
  }

  function deleteLocal(id) {
    return withStore('readwrite', function (store) {
      store.delete(id);
      return id;
    });
  }

  function getToken() {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setToken(token, remember) {
    clearToken();
    if (!token) return '';
    try {
      if (remember) {
        window.localStorage.setItem(TOKEN_KEY, token);
      } else {
        window.sessionStorage.setItem(TOKEN_KEY, token);
      }
    } catch (e) {
      throw new Error('This browser blocked storage of the token.');
    }
    return token;
  }

  function clearToken() {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      return;
    }
  }

  function formatSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'app';
  }

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return window.btoa(parts.join(''));
  }

  function api(path, options) {
    var opts = options || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;

    return window.fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = {}; }
        }
        if (!res.ok) {
          var err = new Error(data.message || ('GitHub responded with ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function serializeEntry(entry) {
    var fields = [
      'id', 'name', 'developer', 'category', 'version', 'size',
      'description', 'icon', 'file', 'website', 'updated', 'featured', 'rating'
    ];
    var out = ['  {'];
    fields.forEach(function (key) {
      var value = entry[key];
      if (value === undefined || value === null || value === '') return;
      if (key === 'featured' || key === 'rating') {
        out.push('    ' + key + ': ' + JSON.stringify(value) + ',');
        return;
      }
      out.push('    ' + key + ': ' + JSON.stringify(String(value)) + ',');
    });
    if (out.length > 1) {
      out[out.length - 1] = out[out.length - 1].replace(/,$/, '');
    }
    out.push('  }');
    return out.join('\n');
  }

  function insertEntry(text, entry) {
    var marker = '];';
    var index = text.lastIndexOf(marker);
    if (index === -1) {
      throw new Error('Could not find the end of the APPS array in apps.js.');
    }
    var head = text.slice(0, index).replace(/\s+$/, '');
    var tail = text.slice(index);
    if (head.charAt(head.length - 1) === '}') head += ',';
    return head + '\n' + serializeEntry(entry) + '\n' + tail;
  }

  function buildEntry(meta, file) {
    var name = String(meta.name || '').trim();
    var id = slugify(meta.id || name);
    var fileName = file.name || id + '.bin';
    return {
      id: id,
      name: name || id,
      developer: String(meta.developer || 'Sachin').trim(),
      category: String(meta.category || 'Utilities').trim(),
      version: String(meta.version || '1.0.0').trim(),
      size: meta.size || formatSize(file.size),
      description: String(meta.description || '').trim(),
      icon: null,
      file: 'apps/' + id + '/' + fileName,
      website: String(meta.website || '').trim() || null,
      updated: new Date().toISOString().slice(0, 10),
      featured: !!meta.featured,
      rating: null
    };
  }

  function publish(meta, file, token, onProgress) {
    if (!token) {
      return Promise.reject(new Error('Add a GitHub token to publish.'));
    }
    if (file.size > MAX_PUBLISH_BYTES) {
      return Promise.reject(new Error('That file is over 90 MB. Save it to your device instead.'));
    }

    var entry = buildEntry(meta, file);
    var step = onProgress || function () {};

    step('Reading the current catalogue');
    return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/contents/apps.js?ref=' + REPO_BRANCH, { token: token })
      .then(function (data) {
        var decoded = atob(String(data.content || '').replace(/\n/g, ''));
        var text = '';
        for (var i = 0; i < decoded.length; i++) text += String.fromCharCode(decoded.charCodeAt(i));
        return insertEntry(text, entry);
      })
      .then(function (newAppsJs) {
        step('Uploading the build');
        return file.arrayBuffer().then(function (buffer) {
          return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/blobs', {
            method: 'POST',
            token: token,
            body: { content: toBase64(buffer), encoding: 'base64' }
          });
        }).then(function (fileBlob) {
          return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/blobs', {
            method: 'POST',
            token: token,
            body: { content: newAppsJs, encoding: 'utf-8' }
          }).then(function (jsBlob) {
            return { fileBlob: fileBlob.sha, jsBlob: jsBlob.sha, entry: entry };
          });
        });
      })
      .then(function (parts) {
        step('Building the commit');
        return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/ref/heads/' + REPO_BRANCH, { token: token })
          .then(function (ref) {
            var headSha = ref.object.sha;
            return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/commits/' + headSha, { token: token })
              .then(function (commit) {
                return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/trees', {
                  method: 'POST',
                  token: token,
                  body: {
                    base_tree: commit.tree.sha,
                    tree: [
                      { path: parts.entry.file, mode: '100644', type: 'blob', sha: parts.fileBlob },
                      { path: 'apps.js', mode: '100644', type: 'blob', sha: parts.jsBlob }
                    ]
                  }
                });
              })
              .then(function (tree) {
                return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/commits', {
                  method: 'POST',
                  token: token,
                  body: {
                    message: 'Publish ' + parts.entry.name + ' to the app store',
                    tree: tree.sha,
                    parents: [headSha]
                  }
                });
              })
              .then(function (newCommit) {
                step('Pushing to the site');
                return api('/repos/' + REPO_OWNER + '/' + REPO_NAME + '/git/refs/heads/' + REPO_BRANCH, {
                  method: 'PATCH',
                  token: token,
                  body: { sha: newCommit.sha, force: false }
                });
              });
          });
      })
      .then(function () {
        return entry;
      });
  }

  return {
    listLocal: listLocal,
    putLocal: putLocal,
    deleteLocal: deleteLocal,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    formatSize: formatSize,
    slugify: slugify,
    buildEntry: buildEntry,
    publish: publish,
    repo: REPO_OWNER + '/' + REPO_NAME
  };
})();
