/**
 * terminal-text-input.js — Compose-and-send text panel for reliable mobile input.
 * Also manages quickbar visibility on non-mobile (toggle via scroll-controls pill).
 * On mobile the quickbar is always visible; the pen button in it opens the text panel.
 */

/* global TerminalControls */

const TerminalTextInput = (() => {
  let _term = null;

  const panel = () => document.getElementById('text-input-panel');
  const textarea = () => document.getElementById('text-input-area');
  const quickbar = () => document.getElementById('terminal-quickbar');
  const toggleBtn = () => document.getElementById('text-input-toggle');
  const penBtn = () => document.getElementById('qk-text-input');

  function init({ term }) {
    _term = term;

    // Auto-open quickbar on mobile
    if (window.matchMedia('(max-width: 768px)').matches) {
      quickbar().classList.add('quickbar-open');
      toggleBtn().classList.add('active');
    }

    // Scroll-controls pill: toggles quickbar
    toggleBtn().addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleQuickbar();
    });

    // Pen button in quickbar: toggles text input panel
    penBtn().addEventListener('touchstart', (e) => { e.preventDefault(); toggleTextInput(); }, { passive: false });
    penBtn().addEventListener('click', (e) => { e.preventDefault(); toggleTextInput(); });

    document.getElementById('text-input-send').addEventListener('click', (e) => {
      e.preventDefault(); sendText();
    });

    document.getElementById('text-input-expand').addEventListener('click', (e) => {
      e.preventDefault(); toggleExpand();
    });

    document.getElementById('text-input-close').addEventListener('click', (e) => {
      e.preventDefault(); closePanel();
    });

    textarea().addEventListener('input', autoResize);
    textarea().addEventListener('keydown', handleKeyDown);
  }

  // ---------- Quickbar toggle (desktop) ----------

  function toggleQuickbar() {
    const qb = quickbar();
    if (qb.classList.contains('quickbar-open')) {
      closePanel();
      qb.classList.remove('quickbar-open');
      toggleBtn().classList.remove('active');
    } else {
      qb.classList.add('quickbar-open');
      toggleBtn().classList.add('active');
    }
    refitTerminal();
  }

  // ---------- Text input panel ----------

  function toggleTextInput() {
    panel().classList.contains('hidden') ? openPanel() : closePanel();
  }

  function refitTerminal() {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function openPanel() {
    // Close text-select overlay if open
    const overlay = document.getElementById('text-select-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      TerminalControls.closeTextSelect();
    }

    panel().classList.remove('hidden');
    penBtn().classList.add('active');
    textarea().value = '';
    resetTextareaHeight();
    refitTerminal();
    textarea().focus();
  }

  function closePanel() {
    if (panel().classList.contains('hidden')) return;
    panel().classList.add('hidden');
    panel().classList.remove('text-input-fullscreen');
    penBtn().classList.remove('active');
    resetTextareaHeight();
    refitTerminal();
    if (_term) _term.focus();
  }

  function toggleExpand() {
    panel().classList.toggle('text-input-fullscreen');
  }

  function sendText() {
    const ta = textarea();
    const text = ta.value;
    if (!text) return;
    if (_term) _term.input(text, true);
    ta.value = '';
    resetTextareaHeight();
    if (!panel().classList.contains('text-input-fullscreen')) {
      closePanel();
    } else {
      ta.focus();
    }
  }

  function autoResize() {
    const ta = textarea();
    const prev = ta.offsetHeight;
    ta.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
    ta.style.height = Math.min(ta.scrollHeight, lineHeight * 5) + 'px';
    if (ta.offsetHeight !== prev) refitTerminal();
  }

  function resetTextareaHeight() {
    const ta = textarea();
    if (ta) ta.style.height = '';
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
    }
  }

  return { init, close: closePanel };
})();
