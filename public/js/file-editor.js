/**
 * file-editor.js — File editor overlay with CodeMirror 6.
 * Read-only view with syntax highlighting, edit mode toggle,
 * unsaved changes indicator, save to disk.
 */

/* global App, FileBrowser, CM */

const FileEditor = (() => {
  let _filePath = '';
  let _originalContent = '';
  let _editorView = null;
  let _editableCompartment = null;
  let _isEditing = false;

  let $overlay, $filename, $modified, $editBtn, $saveBtn, $downloadBtn, $meta, $editorContainer;

  function init() {
    $overlay = document.getElementById('file-editor-overlay');
    $filename = document.getElementById('fe-filename');
    $modified = document.getElementById('fe-modified');
    $editBtn = document.getElementById('fe-edit-btn');
    $saveBtn = document.getElementById('fe-save-btn');
    $downloadBtn = document.getElementById('fe-download-btn');
    $meta = document.getElementById('fe-meta');
    $editorContainer = document.getElementById('fe-editor');

    document.getElementById('fe-back-btn').addEventListener('click', handleBack);
    $editBtn.addEventListener('click', enterEditMode);
    $saveBtn.addEventListener('click', save);
    $downloadBtn.addEventListener('click', () => FileBrowser.downloadFile(_filePath));
  }

  async function open(filePath) {
    _filePath = filePath;
    _isEditing = false;
    const name = filePath.split('/').pop();
    $filename.textContent = name;
    $modified.classList.add('hidden');
    $editBtn.classList.remove('hidden');
    $saveBtn.classList.add('hidden');
    $overlay.querySelector('.fe-topbar').classList.remove('fe-editing');

    try {
      const res = await fetch('/api/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 413) {
          // File too large
          $meta.textContent = `${formatSize(data.size)} — Too large to view in browser`;
          $editorContainer.innerHTML = '<div class="fe-large-warning">File is too large to display. Use the download button.</div>';
          $editBtn.classList.add('hidden');
        } else {
          throw new Error(data.error);
        }
      } else if (data.binary) {
        $meta.textContent = `${formatSize(data.size)} — Binary file`;
        $editorContainer.innerHTML = '<div class="fe-binary-info">Binary file. Use the download button.</div>';
        $editBtn.classList.add('hidden');
      } else {
        _originalContent = data.content;
        const ext = name.split('.').pop();
        $meta.textContent = `${formatSize(data.size)} · ${data.encoding.toUpperCase()} · ${ext.toUpperCase()}`;
        createEditor(data.content, name, false);
      }
    } catch (err) {
      App.showToast(err.message, 'error');
      return;
    }

    $overlay.classList.remove('hidden');
    App.pushOverlay('file-editor', close);
  }

  function createEditor(content, filename, editable) {
    // Destroy existing editor
    if (_editorView) {
      _editorView.destroy();
      _editorView = null;
    }

    _editableCompartment = new CM.Compartment();
    const lang = CM.getLanguage(filename);
    const extensions = [
      CM.createBasicSetup(),
      CM.oneDark,
      _editableCompartment.of(CM.EditorState.readOnly.of(!editable)),
      CM.EditorView.lineWrapping,
    ];
    if (lang) extensions.push(lang);

    // Track changes for modified indicator
    if (editable) {
      extensions.push(CM.EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const current = update.state.doc.toString();
          const modified = current !== _originalContent;
          $modified.classList.toggle('hidden', !modified);
        }
      }));
    }

    _editorView = new CM.EditorView({
      state: CM.EditorState.create({ doc: content, extensions }),
      parent: $editorContainer,
    });
  }

  function enterEditMode() {
    _isEditing = true;
    $editBtn.classList.add('hidden');
    $saveBtn.classList.remove('hidden');
    $overlay.querySelector('.fe-topbar').classList.add('fe-editing');

    // Recreate editor as editable
    const content = _editorView ? _editorView.state.doc.toString() : _originalContent;
    createEditor(content, _filePath.split('/').pop(), true);
  }

  async function save() {
    if (!_editorView) return;
    const content = _editorView.state.doc.toString();
    try {
      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: _filePath, content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      _originalContent = content;
      $modified.classList.add('hidden');
      App.showToast('Saved', 'success', 2000);
      // Return to read-only
      _isEditing = false;
      $editBtn.classList.remove('hidden');
      $saveBtn.classList.add('hidden');
      $overlay.querySelector('.fe-topbar').classList.remove('fe-editing');
      createEditor(content, _filePath.split('/').pop(), false);
    } catch (err) {
      App.showToast('Save failed: ' + err.message, 'error');
    }
  }

  function handleBack() {
    if (_isEditing && _editorView) {
      const current = _editorView.state.doc.toString();
      if (current !== _originalContent) {
        if (!confirm('Discard unsaved changes?')) return;
      }
    }
    close();
  }

  function close() {
    if (_editorView) {
      _editorView.destroy();
      _editorView = null;
    }
    _isEditing = false;
    $editorContainer.innerHTML = '';
    $overlay.classList.add('hidden');
    App.popOverlay('file-editor');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return { init, open, close };
})();
