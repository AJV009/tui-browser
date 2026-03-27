'use strict';

/**
 * tui-overrides.js — Discovers and caches tui.json override files.
 *
 * A tui.json in a session's origin CWD provides custom titles, action buttons,
 * and file browser CWD overrides. Keyed by project identifier (e.g. issue number),
 * each entry has a `sessions` array mapping tmux session names to the override.
 */

const fs = require('fs');
const path = require('path');

// Cache: filePath → { mtimeMs, data, reverseIndex }
// reverseIndex: sessionName → override entry
const cache = new Map();

// Last-known reverse index across all files (sessionName → { override, filePath })
let globalIndex = new Map();

/**
 * Refresh tui.json files for all active sessions.
 * Called during each discovery cycle.
 *
 * @param {Array} sessions - Session objects (need .name, .panes[0].cwd)
 * @param {Object} originCwds - Map of sessionName → origin CWD path
 */
function refreshTuiFiles(sessions, originCwds) {
  // Collect unique CWDs to check
  const cwds = new Set();
  for (const s of sessions) {
    const cwd = originCwds[s.name] || s.panes?.[0]?.cwd || '';
    if (cwd) cwds.add(cwd);
  }

  const newIndex = new Map();

  for (const cwd of cwds) {
    const filePath = path.join(cwd, 'tui.json');

    try {
      const stat = fs.statSync(filePath);
      const cached = cache.get(filePath);

      let data;
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        data = cached.data;
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        data = JSON.parse(raw);
        cache.set(filePath, { mtimeMs: stat.mtimeMs, data });
      }

      // Build reverse index from sessions arrays
      for (const [key, entry] of Object.entries(data)) {
        if (!entry || typeof entry !== 'object' || !Array.isArray(entry.sessions)) continue;
        for (const sessName of entry.sessions) {
          newIndex.set(sessName, { override: entry, filePath });
        }
      }
    } catch {
      // File doesn't exist, parse error, or permission issue — skip silently
      // Remove stale cache entry if the file is gone
      if (cache.has(filePath)) {
        try { fs.statSync(filePath); } catch { cache.delete(filePath); }
      }
    }
  }

  globalIndex = newIndex;
}

/**
 * Get tui.json overrides for a session.
 *
 * @param {string} sessionName - tmux session name
 * @param {string} cwd - origin CWD (or live pane cwd as fallback)
 * @returns {{ title?: string, fileCwd?: string, actions?: Array } | null}
 */
function getTuiOverrides(sessionName, cwd) {
  const entry = globalIndex.get(sessionName);
  if (entry) return entry.override;
  return null;
}

/**
 * Get fileCwd override for a session (convenience for file-routes).
 *
 * @param {string} sessionName
 * @returns {string | null}
 */
function getFileCwd(sessionName) {
  const entry = globalIndex.get(sessionName);
  if (entry && entry.override.fileCwd) return entry.override.fileCwd;
  return null;
}

module.exports = { refreshTuiFiles, getTuiOverrides, getFileCwd };
