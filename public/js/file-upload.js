/**
 * file-upload.js — FilePond wrapper for file upload overlay.
 */

/* global App, FilePond */

const FileUpload = (() => {
  let _pond = null;
  let _targetDir = '';
  let _onComplete = null;
  let $overlay, $targetDirSpan, $container;

  function init() {
    $overlay = document.getElementById('file-upload-overlay');
    $targetDirSpan = document.getElementById('fu-target-dir');
    $container = document.getElementById('fu-pond-container');
    document.getElementById('fu-close-btn').addEventListener('click', close);
  }

  function open(targetDir, onComplete) {
    _targetDir = targetDir;
    _onComplete = onComplete;

    // Display shortened path
    const home = targetDir.match(/^\/home\/[^/]+/)?.[0] || '';
    $targetDirSpan.textContent = home ? '~' + targetDir.slice(home.length) : targetDir;

    // Create FilePond instance
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    $container.innerHTML = '';
    $container.appendChild(input);

    _pond = FilePond.create(input, {
      allowMultiple: true,
      maxFiles: 50,
      server: {
        process: {
          url: '/api/files/upload?targetDir=' + encodeURIComponent(_targetDir),
          method: 'POST',
        },
      },
      labelIdle: 'Drag & drop files or <span class="filepond--label-action">Browse</span>',
      onprocessfiles: () => {
        App.showToast('Upload complete', 'success', 3000);
      },
    });

    $overlay.classList.remove('hidden');
    App.pushOverlay('file-upload', close);
  }

  function close() {
    if ($overlay && $overlay.classList.contains('hidden')) return;
    if (_pond) {
      _pond.destroy();
      _pond = null;
    }
    $container.innerHTML = '';
    $overlay.classList.add('hidden');
    App.popOverlay('file-upload');
    if (_onComplete) {
      _onComplete();
      _onComplete = null;
    }
  }

  return { init, open, close };
})();
