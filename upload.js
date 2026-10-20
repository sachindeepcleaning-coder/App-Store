(function () {
  'use strict';

  var store = window.AppStore;
  var vault = window.Vault;

  var dialog = document.getElementById('uploadDialog');
  var fileInput = document.getElementById('fileInput');
  var dropzone = document.getElementById('dropzone');
  var fileInfo = document.getElementById('fileInfo');
  var errorBox = document.getElementById('uploadError');
  var progressBox = document.getElementById('uploadProgress');
  var uploadBtn = document.getElementById('uploadBtn');

  var fieldName = document.getElementById('fieldName');
  var fieldId = document.getElementById('fieldId');
  var fieldDeveloper = document.getElementById('fieldDeveloper');
  var fieldCategory = document.getElementById('fieldCategory');
  var fieldVersion = document.getElementById('fieldVersion');
  var fieldDescription = document.getElementById('fieldDescription');
  var fieldWebsite = document.getElementById('fieldWebsite');

  var tokenInput = document.getElementById('tokenInput');
  var tokenStatus = document.getElementById('tokenStatus');
  var workerUrlInput = document.getElementById('workerUrl');
  var vaultPassword = document.getElementById('vaultPassword');
  var vaultStatus = document.getElementById('vaultStatus');
  var vaultRemember = document.getElementById('vaultRemember');

  var dest = 'device';
  var pickedFile = null;

  var PANELS = {
    device: document.getElementById('panelDevice'),
    private: document.getElementById('panelPrivate'),
    github: document.getElementById('panelGithub')
  };

  function el(id) {
    return document.getElementById(id);
  }

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function showProgress(message) {
    progressBox.textContent = message || '';
    progressBox.hidden = !message;
  }

  function titleCase(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function setFile(file) {
    pickedFile = file || null;
    if (!pickedFile) {
      fileInfo.textContent = 'No file chosen yet';
      dropzone.classList.remove('has-file');
      return;
    }
    fileInfo.textContent = pickedFile.name + ' · ' + store.formatSize(pickedFile.size);
    dropzone.classList.add('has-file');
    if (!fieldName.value.trim()) fieldName.value = titleCase(String(pickedFile.name || '').replace(/\.[^.]+$/, ''));
    if (!fieldId.value.trim()) fieldId.value = store.slugify(fieldName.value);
  }

  function readMeta() {
    return {
      name: fieldName.value.trim(),
      id: store.slugify(fieldId.value.trim() || fieldName.value),
      developer: fieldDeveloper.value.trim() || 'Sachin',
      category: fieldCategory.value,
      version: fieldVersion.value.trim() || '1.0.0',
      description: fieldDescription.value.trim(),
      website: fieldWebsite.value.trim(),
      featured: false
    };
  }

  function refreshTokenStatus() {
    var token = store.getToken();
    tokenStatus.textContent = token
      ? 'Token saved in this browser. It is only sent to api.github.com.'
      : 'No token set. Publishing is unavailable until you add one.';
  }

  function refreshVaultStatus() {
    var pass = vault.password();
    vaultStatus.textContent = vault.isUnlocked()
      ? 'Unlocked. Uploads and downloads will use your password.'
      : (pass
        ? 'Password remembered on this device. It unlocks automatically.'
        : 'No password saved yet.');
    if (!vaultPassword.value && pass) vaultPassword.value = pass;
  }

  function switchDest(next) {
    dest = next;
    Object.keys(PANELS).forEach(function (key) {
      if (PANELS[key]) PANELS[key].hidden = key !== next;
    });
    document.querySelectorAll('#destSelect .seg').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-dest') === next);
    });
    showError('');
    if (next === 'private') refreshVaultStatus();
    if (next === 'github') refreshTokenStatus();
  }

  function openDialog() {
    showError('');
    showProgress('');
    refreshTokenStatus();
    refreshVaultStatus();
    if (workerUrlInput) workerUrlInput.value = vault.workerUrl();
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  function emitChange(detail) {
    document.dispatchEvent(new CustomEvent('appstore:change', { detail: detail }));
  }

  function resetForm() {
    pickedFile = null;
    setFile(null);
    fileInput.value = '';
    fieldName.value = '';
    fieldId.value = '';
    fieldDeveloper.value = 'Sachin';
    fieldCategory.value = 'Utilities';
    fieldVersion.value = '1.0.0';
    fieldDescription.value = '';
    fieldWebsite.value = '';
    showError('');
    showProgress('');
  }

  function requireFileAndName() {
    if (!pickedFile) {
      showError('Choose a file to upload first.');
      return false;
    }
    if (!fieldName.value.trim()) {
      showError('Give the app a name.');
      return false;
    }
    return true;
  }

  function saveLocally() {
    showError('');
    showProgress('');
    if (!requireFileAndName()) return;

    var entry = store.buildEntry(readMeta(), pickedFile);
    var record = {
      id: entry.id,
      name: entry.name,
      developer: entry.developer,
      category: entry.category,
      version: entry.version,
      size: entry.size,
      description: entry.description,
      icon: null,
      file: pickedFile,
      fileName: pickedFile.name,
      website: entry.website,
      updated: entry.updated,
      featured: entry.featured,
      rating: null,
      source: 'local'
    };

    uploadBtn.disabled = true;
    store.putLocal(record).then(function () {
      uploadBtn.disabled = false;
      resetForm();
      closeDialog();
      emitChange({ type: 'saved', app: record });
    }).catch(function (err) {
      uploadBtn.disabled = false;
      showError(err && err.message ? err.message : 'Could not save the app.');
    });
  }

  function publishToPrivate() {
    showError('');
    showProgress('');
    if (!requireFileAndName()) return;

    var url = (workerUrlInput.value || '').trim() || vault.workerUrl();
    vault.setWorkerUrl(url);

    var pass = vaultPassword.value.trim();
    if (!pass) {
      showError('Enter your private store password.');
      return;
    }
    if (!vaultRemember.checked) {
      vault.setPassword('');
    } else {
      vault.setPassword(pass);
    }

    var meta = readMeta();
    meta.fileName = pickedFile.name;

    uploadBtn.disabled = true;
    showProgress('Unlocking the store…');

    vault.unlock(pass).then(function () {
      if (pickedFile.size <= vault.maxWorkerUpload) {
        showProgress('Uploading to your private store…');
        return vault.upload(meta, pickedFile);
      }

      var token = store.getToken();
      if (!token) {
        throw new Error('Files over 95 MB need a GitHub token. Add one under the GitHub release tab first, then upload again.');
      }
      showProgress('File is large. Uploading straight to the private repository…');
      return vault.uploadLarge(meta, pickedFile, token, function (message) {
        showProgress(message + '…');
      });
    }).then(function (result) {
      uploadBtn.disabled = false;
      resetForm();
      showProgress('Saved to your private store.');
      refreshVaultStatus();
      setTimeout(function () { closeDialog(); }, 900);
      emitChange({ type: 'published', app: result.app || result, provider: 'private' });
    }).catch(function (err) {
      uploadBtn.disabled = false;
      var message = err && err.message ? err.message : 'Upload failed.';
      if (err && err.status === 401) message = 'That password was not accepted.';
      showError(message);
      showProgress('');
    });
  }

  function publishToGithub() {
    showError('');
    showProgress('');
    if (!requireFileAndName()) return;

    var token = tokenInput.value.trim() || store.getToken();
    if (!token) {
      showError('Add a GitHub token first.');
      return;
    }

    var meta = readMeta();
    meta.fileName = pickedFile.name;
    meta.owner = 'sachindeepcleaning-coder';
    meta.repo = 'App-Store';

    uploadBtn.disabled = true;
    showProgress('Publishing…');

    store.publish(readMeta(), pickedFile, token, function (message) {
      showProgress(message + '…');
    }).then(function (entry) {
      uploadBtn.disabled = false;
      resetForm();
      showProgress('Published. The site rebuilds in about a minute.');
      try {
        store.setToken(token, el('tokenRemember').checked);
      } catch (e) {
        showProgress('Published, but the token could not be remembered.');
      }
      setTimeout(function () { closeDialog(); }, 1600);
      emitChange({ type: 'published', app: entry, provider: 'github' });
    }).catch(function (err) {
      uploadBtn.disabled = false;
      var message = err && err.message ? err.message : 'Publishing failed.';
      if (err && err.status === 401) message = 'That token was rejected. Check it and try again.';
      if (err && err.status === 403) message = 'That token lacks permission to write to ' + store.repo + '.';
      if (err && err.status === 404) message = 'Repo or branch not found. Check the token scopes.';
      showError(message);
      showProgress('');
    });
  }

  document.querySelectorAll('[data-open-upload]').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      openDialog();
    });
  });

  el('uploadClose').addEventListener('click', closeDialog);
  el('uploadCancel').addEventListener('click', closeDialog);

  el('uploadForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
  });

  el('destSelect').addEventListener('click', function (ev) {
    var btn = ev.target.closest('.seg');
    if (!btn) return;
    switchDest(btn.getAttribute('data-dest'));
  });

  el('tokenSave').addEventListener('click', function () {
    var token = tokenInput.value.trim();
    try {
      store.setToken(token, el('tokenRemember').checked);
      tokenInput.value = '';
      refreshTokenStatus();
      showError('');
    } catch (err) {
      showError(err && err.message ? err.message : 'Could not store the token.');
    }
  });

  el('tokenClear').addEventListener('click', function () {
    store.clearToken();
    tokenInput.value = '';
    refreshTokenStatus();
  });

  el('vaultClear').addEventListener('click', function () {
    vault.setPassword('');
    vault.lock();
    vaultPassword.value = '';
    refreshVaultStatus();
  });

  fileInput.addEventListener('change', function () {
    setFile(fileInput.files && fileInput.files[0]);
  });

  dropzone.addEventListener('click', function (ev) {
    if (ev.target.tagName === 'INPUT') return;
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (ev) {
      ev.preventDefault();
      dropzone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (ev) {
      ev.preventDefault();
      dropzone.classList.remove('dragging');
    });
  });

  dropzone.addEventListener('drop', function (ev) {
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (files && files.length) setFile(files[0]);
  });

  uploadBtn.addEventListener('click', function () {
    if (dest === 'device') saveLocally();
    else if (dest === 'private') publishToPrivate();
    else publishToGithub();
  });

  dialog.addEventListener('close', function () {
    showProgress('');
  });

  window.AppStoreUI = {
    open: openDialog,
    showPrivate: function (message) {
      switchDest('private');
      openDialog();
      if (message) showError(message);
      setTimeout(function () {
        if (vaultPassword) vaultPassword.focus();
      }, 120);
    }
  };

  switchDest('device');
  refreshTokenStatus();
  refreshVaultStatus();
})();
