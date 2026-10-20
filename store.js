window.AppStore = (function () {
  'use strict';

  var DB_NAME = 'sachin-app-store';
  var DB_VERSION = 1;
  var STORE_NAME = 'apps';
  var TOKEN_KEY = 'sasin-appstore-token';
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

  return {
    listLocal: listLocal,
    putLocal: putLocal,
    deleteLocal: deleteLocal,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    formatSize: formatSize,
    slugify: slugify,
    buildEntry: buildEntry
  };
})();
