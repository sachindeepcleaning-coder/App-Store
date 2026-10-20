(function () {
  'use strict';

  var store = window.AppStore;

  var dialog = document.getElementById('uploadDialog');
  var fileInput = document.getElementById('fileInput');
  var dropzone = document.getElementById('dropzone');
  var fileInfo = document.getElementById('fileInfo');
  var errorBox = document.getElementById('uploadError');
  var progressBox = document.getElementById('uploadProgress');
  var saveBtn = document.getElementById('saveLocalBtn');
  var publishBtn = document.getElementById('publishBtn');
  var tokenInput = document.getElementById('tokenInput');
  var tokenStatus = document.getElementById('tokenStatus');
  var tokenToggle = document.getElementById('tokenPanel');

  var fieldName = document.getElementById('fieldName');
  var fieldId = document.getElementById('fieldId');
  var fieldDeveloper = document.getElementById('fieldDeveloper');
  var fieldCategory = document.getElementById('fieldCategory');
  var fieldVersion = document.getElementById('fieldVersion');
  var fieldDescription = document.getElementById('fieldDescription');
  var fieldWebsite = document.getElementById('fieldWebsite');

  var pickedFile = null;

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

  function guessName(file) {
    return titleCase(String(file.name || '').replace(/\.[^.]+$/, ''));
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
    if (!fieldName.value.trim()) fieldName.value = guessName(pickedFile);
    if (!fieldId.value.trim()) fieldId.value = store.slugify(fieldName.value);
  }

  function readMeta() {
    return {
      name: fieldName.value,
      id: fieldId.value,
      developer: fieldDeveloper.value,
      category: fieldCategory.value,
      version: fieldVersion.value,
      description: fieldDescription.value,
      website: fieldWebsite.value,
      featured: false
    };
  }

  function refreshTokenStatus() {
    var token = store.getToken();
    if (!token) {
      tokenStatus.textContent = 'No token set. Publishing is unavailable until you add one.';
      return;
    }
    tokenStatus.textContent = 'Token saved in this browser. It is only sent to api.github.com.';
  }

  function openDialog() {
    showError('');
    showProgress('');
    refreshTokenStatus();
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

  function saveLocally() {
    showError('');
    showProgress('');
    if (!pickedFile) {
      showError('Choose a file to upload first.');
      return;
    }
    var name = fieldName.value.trim();
    if (!name) {
      showError('Give the app a name.');
      return;
    }
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
    saveBtn.disabled = true;
    store.putLocal(record).then(function () {
      saveBtn.disabled = false;
      resetForm();
      closeDialog();
      emitChange({ type: 'saved', app: record });
    }).catch(function (err) {
      saveBtn.disabled = false;
      showError(err && err.message ? err.message : 'Could not save the app.');
    });
  }

  function publishToGithub() {
    showError('');
    showProgress('');
    if (!pickedFile) {
      showError('Choose a file to upload first.');
      return;
    }
    var name = fieldName.value.trim();
    if (!name) {
      showError('Give the app a name.');
      return;
    }
    var token = tokenInput.value.trim() || store.getToken();
    if (!token) {
      showError('Add a GitHub token to publish. You can still save the app to this device instead.');
      return;
    }

    publishBtn.disabled = true;
    store.publish(readMeta(), pickedFile, token, function (message) {
      showProgress(message + '…');
    }).then(function (entry) {
      publishBtn.disabled = false;
      resetForm();
      showProgress('Published. The site rebuilds in about a minute.');
      try {
        store.setToken(token, el('tokenRemember').checked);
      } catch (e) {
        showProgress('Published, but the token could not be remembered.');
      }
      setTimeout(function () {
        closeDialog();
      }, 1600);
      emitChange({ type: 'published', app: entry });
    }).catch(function (err) {
      publishBtn.disabled = false;
      var message = err && err.message ? err.message : 'Publishing failed.';
      if (err && err.status === 401) message = 'That token was rejected. Check it and try again.';
      if (err && err.status === 403) message = 'That token lacks permission to write to ' + store.repo + '.';
      if (err && err.status === 404) message = 'Repo or branch not found. Check the token scopes.';
      showError(message);
    });
  }

  document.querySelectorAll('[data-open-upload]').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      openDialog();
    });
  });

  el('uploadForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
  });

  el('uploadClose').addEventListener('click', closeDialog);
  el('uploadCancel').addEventListener('click', closeDialog);

  el('tokenPanel').addEventListener('click', function () {
    tokenToggle.classList.toggle('open');
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

  saveBtn.addEventListener('click', saveLocally);
  publishBtn.addEventListener('click', publishToGithub);

  dialog.addEventListener('close', function () {
    showProgress('');
  });

  refreshTokenStatus();
})();
