/**
 * terminal-notes.js — Sent history panel (inline in text input) + Notes overlay (global, top-right pill).
 * Sent: per-session input history. Notes: persistent scratchpad accessible from any terminal.
 */

/* global App, ServerManager */

const TerminalNotes = (() => {
  let _sessionName = null;
  let _loadIntoTextarea = null;
  let _history = [];
  let _notes = [];

  // ---------- Sent History (inline panel inside text input) ----------

  const historyPanel = () => document.getElementById('sent-history-panel');
  const historyContent = () => document.getElementById('sent-history-content');

  function initSentHistory({ sessionName, loadIntoTextarea }) {
    _sessionName = sessionName;
    _loadIntoTextarea = loadIntoTextarea;

    document.getElementById('text-input-notes-btn').addEventListener('click', (e) => {
      e.preventDefault();
      toggleHistory();
    });

    historyContent().addEventListener('click', (e) => {
      const item = e.target.closest('[data-action="load"]');
      if (!item) return;
      if (_loadIntoTextarea) _loadIntoTextarea(item.dataset.text);
      closeHistory();
    });
  }

  function isHistoryOpen() {
    return !historyPanel().classList.contains('hidden');
  }

  function toggleHistory() {
    isHistoryOpen() ? closeHistory() : openHistory();
  }

  async function openHistory() {
    historyPanel().classList.remove('hidden');
    document.getElementById('text-input-notes-btn').classList.add('active');
    await fetchHistory();
    renderHistory();
  }

  function closeHistory() {
    historyPanel().classList.add('hidden');
    document.getElementById('text-input-notes-btn').classList.remove('active');
  }

  async function fetchHistory() {
    if (!_sessionName) return;
    try {
      const sn = App.getCurrentServer();
      const origin = sn ? ServerManager.getOrigin(sn) : '';
      const res = await fetch(`${origin}/api/sessions/${encodeURIComponent(_sessionName)}/input-history`);
      if (res.ok) {
        const data = await res.json();
        _history = data.entries || [];
      }
    } catch { /* ignore */ }
  }

  function renderHistory() {
    if (_history.length === 0) {
      historyContent().innerHTML = '<div class="notes-empty">No sent commands yet</div>';
      return;
    }
    historyContent().innerHTML = _history.map(entry => `
      <div class="notes-item" data-action="load" data-text="${esc(entry.text).replace(/"/g, '&quot;')}">
        <span class="notes-item-text">${esc(truncate(entry.text, 120))}</span>
        <span class="notes-item-meta">${timeAgo(entry.sentAt)}</span>
      </div>`).join('');
  }

  // ---------- Notes Overlay (global, triggered from pill button) ----------

  const notesOverlay = () => document.getElementById('notes-overlay');
  const notesList = () => document.getElementById('notes-overlay-list');

  let _notesInitialized = false;

  function initNotesOverlay() {
    if (_notesInitialized) return;
    _notesInitialized = true;

    document.getElementById('notes-toggle-btn').addEventListener('click', (e) => {
      e.preventDefault();
      toggleNotes();
    });

    document.getElementById('notes-close').addEventListener('click', () => closeNotes());

    document.getElementById('notes-add-btn').addEventListener('click', () => {
      addNote(document.getElementById('notes-add-input'));
    });

    document.getElementById('notes-add-input').addEventListener('input', (e) => {
      autoResizeTextarea(e.target, 10);
    });

    notesList().addEventListener('click', (e) => {
      const loadBtn = e.target.closest('[data-action="load"]');
      if (loadBtn) {
        const text = loadBtn.dataset.text;
        if (_loadIntoTextarea) {
          _loadIntoTextarea(text);
        } else {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        closeNotes();
        return;
      }

      const deleteBtn = e.target.closest('[data-action="delete-note"]');
      if (deleteBtn) { deleteNote(deleteBtn.dataset.noteId); return; }

      const editBtn = e.target.closest('[data-action="edit-note"]');
      if (editBtn) { startEditNote(editBtn.dataset.noteId); return; }

      const saveBtn = e.target.closest('[data-action="save-edit"]');
      if (saveBtn) { finishEditNote(saveBtn.dataset.noteId); return; }

      const cancelBtn = e.target.closest('[data-action="cancel-edit"]');
      if (cancelBtn) { renderNotes(); return; }
    });
  }

  function isNotesOpen() {
    return !notesOverlay().classList.contains('hidden');
  }

  function toggleNotes() {
    isNotesOpen() ? closeNotes() : openNotes();
  }

  async function openNotes() {
    notesOverlay().classList.remove('hidden');
    document.getElementById('notes-toggle-btn').classList.add('active');
    App.pushOverlay('notes', closeNotes);
    const hint = document.getElementById('notes-overlay-hint');
    hint.textContent = _loadIntoTextarea
      ? 'Tap a note to load it into the text editor'
      : 'Tap a note to copy it';
    await fetchNotes();
    renderNotes();
    document.getElementById('notes-add-input').focus();
  }

  function closeNotes() {
    if (notesOverlay().classList.contains('hidden')) return;
    App.popOverlay('notes');
    notesOverlay().classList.add('hidden');
    document.getElementById('notes-toggle-btn').classList.remove('active');
  }

  async function fetchNotes() {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) _notes = await res.json();
    } catch { /* ignore */ }
  }

  function renderNotes() {
    if (_notes.length === 0) {
      notesList().innerHTML = '<div class="notes-empty">No notes yet</div>';
      return;
    }
    notesList().innerHTML = _notes.map(note => `
      <div class="notes-item notes-note-item">
        <div class="notes-item-text notes-text-clamp" data-action="load" data-text="${esc(note.text).replace(/"/g, '&quot;')}">${esc(note.text)}</div>
        <div class="notes-item-actions">
          <button class="notes-action-btn" data-action="edit-note" data-note-id="${note.id}" title="Edit"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L3.463 11.1a.25.25 0 00-.064.108l-.563 1.97 1.971-.564a.25.25 0 00.108-.064l8.61-8.61a.25.25 0 000-.353L12.427 2.488z"/></svg></button>
          <button class="notes-action-btn notes-action-delete" data-action="delete-note" data-note-id="${note.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3V1.75zM11 3V1.75A1.75 1.75 0 009.25 0h-2.5A1.75 1.75 0 005 1.75V3H2.75a.75.75 0 000 1.5h.61l.71 9.17A1.75 1.75 0 005.82 15.5h4.36a1.75 1.75 0 001.75-1.83l.71-9.17h.61a.75.75 0 000-1.5H11z"/></svg></button>
        </div>
      </div>`).join('');
  }

  async function addNote(input) {
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        _notes = await res.json();
        input.value = '';
        input.style.height = '';
        renderNotes();
      }
    } catch { /* ignore */ }
  }

  async function deleteNote(id) {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        _notes = await res.json();
        renderNotes();
      }
    } catch { /* ignore */ }
  }

  function startEditNote(id) {
    const note = _notes.find(n => n.id === id);
    if (!note) return;
    const items = notesList().querySelectorAll('.notes-note-item');
    for (const item of items) {
      const editBtn = item.querySelector(`[data-note-id="${id}"][data-action="edit-note"]`);
      if (!editBtn) continue;
      item.innerHTML = `
        <textarea class="notes-edit-input" id="notes-edit-${id}" rows="1">${esc(note.text)}</textarea>
        <div class="notes-item-actions">
          <button class="notes-action-btn notes-action-save" data-action="save-edit" data-note-id="${id}" title="Save"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 4"/></svg></button>
          <button class="notes-action-btn" data-action="cancel-edit" title="Cancel"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </div>`;
      const editInput = document.getElementById(`notes-edit-${id}`);
      autoResizeTextarea(editInput, 10);
      editInput.focus();
      editInput.addEventListener('input', () => autoResizeTextarea(editInput, 10));
      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); renderNotes(); }
      });
      break;
    }
  }

  async function finishEditNote(id) {
    const input = document.getElementById(`notes-edit-${id}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        _notes = await res.json();
        renderNotes();
      }
    } catch { /* ignore */ }
  }

  // ---------- Textarea auto-resize ----------

  function autoResizeTextarea(ta, maxLines) {
    ta.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 18;
    ta.style.height = Math.min(ta.scrollHeight, lineHeight * maxLines) + 'px';
  }

  // ---------- Shared helpers ----------

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function truncate(text, len) {
    return text.length > len ? text.slice(0, len) + '…' : text;
  }

  // ---------- Public API ----------

  function init({ sessionName, loadIntoTextarea }) {
    _sessionName = sessionName;
    _loadIntoTextarea = loadIntoTextarea;
    initSentHistory({ sessionName, loadIntoTextarea });
    initNotesOverlay();
  }

  function setSession(sessionName) {
    _sessionName = sessionName;
  }

  return { init, initNotesOverlay, setSession, closeHistory, closeNotes, isHistoryOpen, isNotesOpen };
})();
