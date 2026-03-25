# File Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-aware file browser overlay to TUI Browser that enables browsing, viewing, editing, uploading, and downloading files from any device.

**Architecture:** Fully custom REST API backend (`server/file-routes.js`) + three IIFE frontend modules (`file-browser.js`, `file-editor.js`, `file-upload.js`). File icons from vscode-icons, text editing via pre-bundled CodeMirror 6, uploads via FilePond CDN. Integrates as an overlay accessible from the top menu bar in both terminal and dashboard views.

**Tech Stack:** Express REST API, multer (uploads), archiver (zip downloads), vscode-icons-js (icon mapping), CodeMirror 6 (editor), FilePond (upload widget)

**Spec:** `docs/superpowers/specs/2026-03-25-file-browser-design.md`

**Testing approach:** This project has no test suite. Verify each task by testing against the running server (`npm start` or `PORT=7483 npm start`), using `curl` for API endpoints and manual browser verification for frontend.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/file-routes.js` | All `/api/files/*` REST endpoints — list, read, write, upload, download, mkdir, rename, delete, move, copy, cwd |
| `public/js/file-browser.js` | IIFE module — file list overlay, navigation, breadcrumbs, context menu, selection mode, directory picker |
| `public/js/file-editor.js` | IIFE module — CodeMirror 6 wrapper for read-only viewing and editing text files |
| `public/js/file-upload.js` | IIFE module — FilePond wrapper for file upload overlay |
| `public/css/file-browser.css` | All file browser styles — overlay, file list, context menu, selection, editor, upload, directory picker |
| `public/vendor/codemirror.bundle.js` | Pre-built CodeMirror 6 bundle (vendored, committed to git) |
| `public/vendor/vscode-icons.js` | Pre-built browser bundle exposing `getIconForFile()` / `getIconForFolder()` globally |
| `scripts/bundle-codemirror.sh` | Dev-time script to rebuild the CodeMirror bundle |
| `scripts/bundle-vscode-icons.sh` | Dev-time script to rebuild the vscode-icons browser bundle |
| `public/icons/` | vscode-icons SVGs (~1,480 files) copied from npm package |
| `data/file-browser-config.json` | Runtime config — allowed roots, hidden files toggle, sort default, max file size |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add `multer`, `archiver`, `vscode-icons-js` dependencies |
| `server/index.js` | Require and register `file-routes.js` (2 lines) |
| `public/index.html` | Add CSS link, overlay HTML div, script tags, FilePond CDN, CodeMirror vendor script |
| `public/js/app.js` | Add `files` to views map, handle `#files` route in `handleRoute()`, call `FileBrowser.init()` |
| `public/js/terminal-controls.js` | Add file browser icon button click handler |
| `public/js/dashboard.js` | Add file browser button click handler |

---

## Task 1: Dependencies & Vendor Setup

**Files:**
- Modify: `package.json`
- Create: `scripts/bundle-codemirror.sh`
- Create: `public/vendor/codemirror.bundle.js`
- Create: `public/icons/` (vscode-icons SVGs)

- [ ] **Step 1: Install npm dependencies**

```bash
cd /home/alphons/project/tui-browser
npm install multer@1 archiver@6 vscode-icons-js@12
```

Verify: `cat package.json` shows multer, archiver, vscode-icons-js in dependencies.

- [ ] **Step 2: Copy vscode-icons SVGs to public/icons/**

```bash
mkdir -p public/icons
cp node_modules/vscode-icons-js/icons/* public/icons/
ls public/icons/ | wc -l
```

Expected: ~1,480 SVG files copied.

- [ ] **Step 3: Create CodeMirror bundle script**

Create `scripts/bundle-codemirror.sh`:

```bash
#!/bin/bash
# One-time build script for CodeMirror 6 bundle
# Run: bash scripts/bundle-codemirror.sh
# Output: public/vendor/codemirror.bundle.js

set -e
cd "$(dirname "$0")/.."

# Install build-time deps (not saved to package.json)
npm install --no-save esbuild \
  @codemirror/view @codemirror/state @codemirror/commands \
  @codemirror/language @codemirror/autocomplete @codemirror/search \
  @codemirror/lint \
  @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css \
  @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-python \
  @codemirror/lang-xml @codemirror/lang-yaml @codemirror/lang-sql \
  @codemirror/lang-cpp @codemirror/lang-java @codemirror/lang-rust \
  @codemirror/lang-php \
  @codemirror/theme-one-dark

# Create entry point
cat > /tmp/cm-entry.js << 'ENTRY'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { php } from "@codemirror/lang-php";

const languages = { javascript, html, css, json, markdown, python, xml, yaml, sql, cpp, java, rust, php };

function getLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'javascript', tsx: 'javascript',
    html: 'html', htm: 'html', svelte: 'html', vue: 'html',
    css: 'css', scss: 'css', less: 'css',
    json: 'json', jsonc: 'json',
    md: 'markdown', mdx: 'markdown',
    py: 'python', pyw: 'python',
    xml: 'xml', svg: 'xml', xsl: 'xml',
    yaml: 'yaml', yml: 'yaml',
    sql: 'sql',
    c: 'cpp', cc: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
    java: 'java',
    rs: 'rust',
    php: 'php',
  };
  const lang = map[ext];
  return lang && languages[lang] ? languages[lang]() : null;
}

function createBasicSetup() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    foldGutter(),
    history(),
    autocompletion(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
  ];
}

window.CM = {
  EditorView,
  EditorState,
  Compartment,
  oneDark,
  getLanguage,
  createBasicSetup,
};
ENTRY

mkdir -p public/vendor
npx esbuild /tmp/cm-entry.js \
  --bundle \
  --format=iife \
  --minify \
  --outfile=public/vendor/codemirror.bundle.js

rm /tmp/cm-entry.js
echo "Built: public/vendor/codemirror.bundle.js ($(wc -c < public/vendor/codemirror.bundle.js) bytes)"
```

- [ ] **Step 4: Run the bundle script**

```bash
bash scripts/bundle-codemirror.sh
```

Expected: `public/vendor/codemirror.bundle.js` created. Should be ~200-400KB.

- [ ] **Step 5: Create vscode-icons browser bundle**

Create `scripts/bundle-vscode-icons.sh`:

```bash
#!/bin/bash
# One-time build script for vscode-icons-js browser bundle
set -e
cd "$(dirname "$0")/.."

npm install --no-save esbuild

cat > /tmp/vscode-icons-entry.js << 'ENTRY'
const { getIconForFile, getIconForFolder, getIconForOpenFolder } = require('vscode-icons-js');
window.getIconForFile = getIconForFile;
window.getIconForFolder = getIconForFolder;
window.getIconForOpenFolder = getIconForOpenFolder;
ENTRY

mkdir -p public/vendor
npx esbuild /tmp/vscode-icons-entry.js \
  --bundle \
  --format=iife \
  --platform=browser \
  --minify \
  --outfile=public/vendor/vscode-icons.js

rm /tmp/vscode-icons-entry.js
echo "Built: public/vendor/vscode-icons.js ($(wc -c < public/vendor/vscode-icons.js) bytes)"
```

```bash
bash scripts/bundle-vscode-icons.sh
```

Expected: `public/vendor/vscode-icons.js` created, exposing `window.getIconForFile`, `window.getIconForFolder`.

- [ ] **Step 6: Verify vendor setup**

```bash
# Verify icons exist
ls public/icons/ | head -5

# Verify CodeMirror bundle exists and exposes CM global
node -e "const fs = require('fs'); const b = fs.readFileSync('public/vendor/codemirror.bundle.js', 'utf8'); console.log('Bundle size:', b.length, 'bytes'); console.log('Has CM global:', b.includes('window.CM'));"

# Verify vscode-icons browser bundle exists and exposes globals
node -e "const fs = require('fs'); const b = fs.readFileSync('public/vendor/vscode-icons.js', 'utf8'); console.log('Bundle size:', b.length, 'bytes'); console.log('Has getIconForFile:', b.includes('getIconForFile'));"

# Verify vscode-icons-js works from Node (for reference)
node -e "const { getIconForFile, getIconForFolder } = require('vscode-icons-js'); console.log('package.json:', getIconForFile('package.json')); console.log('src folder:', getIconForFolder('src'));"
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/bundle-codemirror.sh scripts/bundle-vscode-icons.sh public/vendor/codemirror.bundle.js public/vendor/vscode-icons.js
# Note: public/icons/ is large (~1,480 SVGs). Add to git or .gitignore based on preference.
# If committing: git add public/icons/
# If not: echo "public/icons/" >> .gitignore && git add .gitignore
git commit -m "feat(file-browser): add dependencies and vendor assets

Add multer, archiver, vscode-icons-js. Bundle CodeMirror 6.
Copy vscode-icons SVGs to public/icons/."
```

---

## Task 2: Backend API — Core File Operations

**Files:**
- Create: `server/file-routes.js`
- Modify: `server/index.js` (lines 18, 56-59)

- [ ] **Step 1: Create server/file-routes.js with path validation and config**

Create `server/file-routes.js` with the security foundation — path validation helper and config loading:

```javascript
'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'file-browser-config.json');

const DEFAULT_CONFIG = {
  allowedRoots: ['$HOME'],
  showHiddenFiles: false,
  defaultSort: 'name',
  maxFileSize: 1048576, // 1MB
};

function loadConfig() {
  try {
    const raw = fsSync.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
  fsSync.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function expandRoot(root) {
  return root.replace('$HOME', os.homedir());
}

function getAllowedRoots() {
  const config = loadConfig();
  return config.allowedRoots.map(expandRoot);
}

async function validatePath(filePath) {
  const resolved = path.resolve(filePath);
  let real;
  try {
    real = await fs.realpath(resolved);
  } catch {
    // File may not exist yet (e.g., mkdir, write new file) — use parent
    const parent = path.dirname(resolved);
    try {
      real = path.join(await fs.realpath(parent), path.basename(resolved));
    } catch {
      throw new Error('Path not accessible');
    }
  }
  const roots = getAllowedRoots();
  const allowed = roots.some(root => real === root || real.startsWith(root + path.sep));
  if (!allowed) throw new Error('Access denied: path outside allowed roots');
  return real;
}

function apiHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.message.includes('Access denied') ? 403
        : err.code === 'ENOENT' ? 404
        : err.code === 'EACCES' ? 403
        : 500;
      res.status(status).json({ error: err.message });
    }
  };
}

function isBinary(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
```

- [ ] **Step 2: Add list, read, write endpoints**

Append to `server/file-routes.js` — the `setup()` function with core read/write endpoints:

```javascript
function setup(app) {
  // List directory contents
  app.post('/api/files/list', apiHandler(async (req, res) => {
    const dirPath = await validatePath(req.body.path);
    const config = loadConfig();
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!config.showHiddenFiles && entry.name.startsWith('.')) continue;
      try {
        const fullPath = path.join(dirPath, entry.name);
        const stat = await fs.stat(fullPath);
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          permissions: '0' + (stat.mode & 0o777).toString(8),
        });
      } catch {
        // Skip inaccessible entries
      }
    }
    // Folders first, then files, both sorted by name
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json(items);
  }));

  // Read file contents
  app.post('/api/files/read', apiHandler(async (req, res) => {
    const filePath = await validatePath(req.body.path);
    const stat = await fs.stat(filePath);
    const config = loadConfig();
    if (stat.size > config.maxFileSize) {
      return res.status(413).json({
        error: 'File too large for in-browser viewing',
        size: stat.size,
        maxSize: config.maxFileSize,
      });
    }
    const buffer = await fs.readFile(filePath);
    if (isBinary(buffer)) {
      return res.json({ binary: true, size: stat.size, name: path.basename(filePath) });
    }
    const content = buffer.toString('utf8');
    res.json({ content, encoding: 'utf8', size: stat.size });
  }));

  // Write file contents
  app.post('/api/files/write', apiHandler(async (req, res) => {
    const filePath = await validatePath(req.body.path);
    await fs.writeFile(filePath, req.body.content, 'utf8');
    res.json({ success: true });
  }));
}

module.exports = { setup };
```

- [ ] **Step 3: Register file-routes in server/index.js**

In `server/index.js`:
- After line 17 (`const routes = require('./routes');`), add: `const fileRoutes = require('./file-routes');`
- After line 59 (end of `routes.setup()` call), add: `fileRoutes.setup(app);`

- [ ] **Step 4: Verify list/read/write endpoints**

Start server and test:

```bash
# Start server in background
PORT=7483 npm start &
sleep 2

# Test list
curl -s -X POST http://localhost:7483/api/files/list \
  -H 'Content-Type: application/json' \
  -d "{\"path\": \"$HOME\"}" | head -c 500

# Test read
curl -s -X POST http://localhost:7483/api/files/read \
  -H 'Content-Type: application/json' \
  -d '{"path": "'$HOME'/project/tui-browser/package.json"}'

# Test write (create temp file)
curl -s -X POST http://localhost:7483/api/files/write \
  -H 'Content-Type: application/json' \
  -d '{"path": "'$HOME'/project/tui-browser/data/test-write.txt", "content": "hello"}'
cat $HOME/project/tui-browser/data/test-write.txt
rm $HOME/project/tui-browser/data/test-write.txt

# Test path traversal blocked
curl -s -X POST http://localhost:7483/api/files/list \
  -H 'Content-Type: application/json' \
  -d '{"path": "/etc"}'
# Expected: 403 Access denied

kill %1
```

- [ ] **Step 5: Add mkdir, rename, delete endpoints**

Append inside `setup()` in `server/file-routes.js`:

```javascript
  // Create directory
  app.post('/api/files/mkdir', apiHandler(async (req, res) => {
    const dirPath = await validatePath(req.body.path);
    await fs.mkdir(dirPath, { recursive: true });
    res.json({ success: true });
  }));

  // Rename file or folder
  app.post('/api/files/rename', apiHandler(async (req, res) => {
    const oldPath = await validatePath(req.body.oldPath);
    const newPath = await validatePath(req.body.newPath);
    try {
      await fs.access(newPath);
      return res.status(409).json({ error: 'exists', existing: { name: path.basename(newPath) } });
    } catch { /* doesn't exist, good */ }
    await fs.rename(oldPath, newPath);
    res.json({ success: true });
  }));

  // Delete file or folder
  app.post('/api/files/delete', apiHandler(async (req, res) => {
    const filePath = await validatePath(req.body.path);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    res.json({ success: true });
  }));
```

- [ ] **Step 6: Add move, copy endpoints**

Append inside `setup()`:

```javascript
  // Move file or folder
  app.post('/api/files/move', apiHandler(async (req, res) => {
    const src = await validatePath(req.body.src);
    const dest = await validatePath(req.body.dest);
    if (!req.body.overwrite) {
      try {
        await fs.access(dest);
        const stat = await fs.stat(dest);
        return res.status(409).json({
          error: 'exists',
          existing: { name: path.basename(dest), type: stat.isDirectory() ? 'directory' : 'file', size: stat.size },
        });
      } catch { /* doesn't exist, good */ }
    }
    await fs.rename(src, dest);
    res.json({ success: true });
  }));

  // Copy file or folder
  app.post('/api/files/copy', apiHandler(async (req, res) => {
    const src = await validatePath(req.body.src);
    const dest = await validatePath(req.body.dest);
    if (!req.body.overwrite) {
      try {
        await fs.access(dest);
        const stat = await fs.stat(dest);
        return res.status(409).json({
          error: 'exists',
          existing: { name: path.basename(dest), type: stat.isDirectory() ? 'directory' : 'file', size: stat.size },
        });
      } catch { /* doesn't exist, good */ }
    }
    const stat = await fs.stat(src);
    if (stat.isDirectory()) {
      await fs.cp(src, dest, { recursive: true });
    } else {
      await fs.copyFile(src, dest);
    }
    res.json({ success: true });
  }));
```

- [ ] **Step 7: Add upload endpoint (multer)**

Append inside `setup()`:

```javascript
  // Upload files
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const dir = await validatePath(req.body.targetDir || req.query.targetDir);
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // Handle conflicts: append (1), (2) etc.
      const dir = req.body.targetDir || req.query.targetDir;
      const resolve = (name, attempt) => {
        const full = path.join(dir, name);
        try {
          fsSync.accessSync(full);
          // File exists — generate new name
          const ext = path.extname(file.originalname);
          const base = path.basename(file.originalname, ext);
          return resolve(`${base} (${attempt})${ext}`, attempt + 1);
        } catch {
          return name;
        }
      };
      cb(null, resolve(file.originalname, 1));
    },
  });
  const upload = multer({ storage });

  // Note: FilePond sends files with field name 'filepond' by default
  app.post('/api/files/upload', upload.array('filepond', 50), apiHandler(async (req, res) => {
    const files = (req.files || []).map(f => ({ name: f.filename, size: f.size }));
    res.json({ files });
  }));
```

- [ ] **Step 8: Add download endpoint (archiver)**

Append inside `setup()`:

```javascript
  // Download file or zip folder
  const archiver = require('archiver');

  app.post('/api/files/download', apiHandler(async (req, res) => {
    const filePath = await validatePath(req.body.path);
    const stat = await fs.stat(filePath);
    const name = path.basename(filePath);

    if (stat.isDirectory()) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(res);
      archive.directory(filePath, name);
      await archive.finalize();
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', stat.size);
      const stream = fsSync.createReadStream(filePath);
      stream.pipe(res);
    }
  }));
```

- [ ] **Step 9: Add CWD endpoint**

Append inside `setup()`:

```javascript
  // Get CWD of a tmux session
  const run = require('./exec-util');

  app.get('/api/files/cwd', apiHandler(async (req, res) => {
    const session = req.query.session;
    if (!session) return res.status(400).json({ error: 'session parameter required' });
    try {
      const cwd = await run('tmux', ['display', '-t', session, '-p', '#{pane_current_path}']);
      res.json({ path: cwd.trim() });
    } catch {
      // Fallback to home directory
      res.json({ path: os.homedir() });
    }
  }));
```

- [ ] **Step 10: Verify all backend endpoints**

```bash
PORT=7483 npm start &
sleep 2

# mkdir
curl -s -X POST http://localhost:7483/api/files/mkdir \
  -H 'Content-Type: application/json' \
  -d '{"path": "'$HOME'/project/tui-browser/data/test-dir"}'

# rename
curl -s -X POST http://localhost:7483/api/files/rename \
  -H 'Content-Type: application/json' \
  -d '{"oldPath": "'$HOME'/project/tui-browser/data/test-dir", "newPath": "'$HOME'/project/tui-browser/data/test-dir2"}'

# delete
curl -s -X POST http://localhost:7483/api/files/delete \
  -H 'Content-Type: application/json' \
  -d '{"path": "'$HOME'/project/tui-browser/data/test-dir2"}'

# upload
curl -s -X POST http://localhost:7483/api/files/upload \
  -F "targetDir=$HOME/project/tui-browser/data" \
  -F "files=@$HOME/project/tui-browser/package.json"

# download (file)
curl -s -X POST http://localhost:7483/api/files/download \
  -H 'Content-Type: application/json' \
  -d '{"path": "'$HOME'/project/tui-browser/package.json"}' -o /tmp/test-dl.json
cat /tmp/test-dl.json

# cwd (requires active tmux session)
curl -s http://localhost:7483/api/files/cwd?session=main

# cleanup
rm -f $HOME/project/tui-browser/data/package.json /tmp/test-dl.json

kill %1
```

- [ ] **Step 11: Commit backend**

```bash
git add server/file-routes.js server/index.js
git commit -m "feat(file-browser): add backend REST API for file operations

Endpoints: list, read, write, upload, download, mkdir, rename,
delete, move, copy, cwd. Path traversal prevention on all endpoints.
Configurable allowed roots via data/file-browser-config.json."
```

---

## Task 3: Frontend — HTML Shell & CSS

**Files:**
- Modify: `public/index.html` (add CSS link, overlay div, script tags, CDN links)
- Create: `public/css/file-browser.css`

- [ ] **Step 1: Add CSS link and CDN assets to index.html**

In `public/index.html`:
- After the last CSS link (line 18, `info-panel.css`), add:
  ```html
  <link rel="stylesheet" href="/css/file-browser.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/filepond@4/dist/filepond.min.css">
  ```

- [ ] **Step 2: Add file browser overlay HTML to index.html**

After the session-info-overlay closing `</div>` (around line 189), add:

```html
    <!-- File Browser Overlay -->
    <div id="file-browser-overlay" class="file-browser-overlay hidden">
      <div class="fb-topbar">
        <button id="fb-back-btn" class="nav-btn nav-btn-icon" title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div id="fb-breadcrumb" class="fb-breadcrumb"></div>
        <button id="fb-menu-btn" class="nav-btn nav-btn-icon" title="Menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
      </div>
      <div class="fb-actions">
        <button id="fb-upload-btn" class="fb-pill fb-pill-accent">↑ Upload</button>
        <button id="fb-mkdir-btn" class="fb-pill">+ New Folder</button>
        <button id="fb-sort-btn" class="fb-pill">Sort ↕</button>
        <button id="fb-hidden-btn" class="fb-pill">Hidden</button>
      </div>
      <div id="fb-file-list" class="fb-file-list"></div>
      <div id="fb-selection-bar" class="fb-selection-bar hidden">
        <button data-action="copy" class="fb-sel-action"><span>📋</span><span>Copy</span></button>
        <button data-action="move" class="fb-sel-action"><span>📦</span><span>Move</span></button>
        <button data-action="download" class="fb-sel-action"><span>↓</span><span>Download</span></button>
        <button data-action="delete" class="fb-sel-action fb-sel-danger"><span>🗑</span><span>Delete</span></button>
      </div>
    </div>

    <!-- File Editor Overlay -->
    <div id="file-editor-overlay" class="file-editor-overlay hidden">
      <div class="fe-topbar">
        <button id="fe-back-btn" class="nav-btn nav-btn-icon" title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div class="fe-title">
          <span id="fe-filename"></span>
          <span id="fe-modified" class="fe-modified hidden">●</span>
        </div>
        <button id="fe-edit-btn" class="btn btn-secondary btn-sm">Edit</button>
        <button id="fe-save-btn" class="btn btn-primary btn-sm hidden">Save</button>
        <button id="fe-download-btn" class="nav-btn nav-btn-icon" title="Download">↓</button>
      </div>
      <div id="fe-meta" class="fe-meta"></div>
      <div id="fe-editor" class="fe-editor"></div>
    </div>

    <!-- File Upload Overlay -->
    <div id="file-upload-overlay" class="file-upload-overlay hidden">
      <div class="fu-topbar">
        <button id="fu-close-btn" class="nav-btn nav-btn-icon" title="Close">✕</button>
        <span class="fu-title">Upload to <span id="fu-target-dir"></span></span>
      </div>
      <div id="fu-pond-container" class="fu-pond-container"></div>
    </div>

    <!-- Directory Picker Overlay (for copy/move) -->
    <div id="dir-picker-overlay" class="dir-picker-overlay hidden">
      <div class="dp-topbar">
        <button id="dp-close-btn" class="nav-btn nav-btn-icon" title="Cancel">✕</button>
        <span id="dp-title" class="dp-title">Move to...</span>
      </div>
      <div id="dp-breadcrumb" class="fb-breadcrumb" style="padding: 8px 12px;"></div>
      <div id="dp-dir-list" class="fb-file-list"></div>
      <div class="dp-footer">
        <button id="dp-mkdir-btn" class="fb-pill">+ New Folder</button>
        <button id="dp-confirm-btn" class="btn btn-primary">Move Here</button>
      </div>
    </div>

    <!-- Context Menu -->
    <div id="fb-context-menu" class="fb-context-menu hidden"></div>
    <div id="fb-context-backdrop" class="fb-context-backdrop hidden"></div>
```

- [ ] **Step 3: Add script tags to index.html**

After the terminal-controls.js script tag (around line 213), add:

```html
    <script src="/vendor/codemirror.bundle.js"></script>
    <script src="/vendor/vscode-icons.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/filepond@4/dist/filepond.min.js"></script>
    <script src="/js/file-browser.js"></script>
    <script src="/js/file-editor.js"></script>
    <script src="/js/file-upload.js"></script>
```

- [ ] **Step 4: Add file browser icon to terminal view header**

In `public/index.html`, in the terminal header area (around line 34, near the notes-toggle-btn), add:

```html
<button id="files-toggle-btn" class="nav-btn nav-btn-icon" title="File Browser">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
</button>
```

- [ ] **Step 5: Add file browser button to dashboard toolbar**

In `public/index.html`, in the dashboard toolbar area (around line 55, near bulk-kill-btn), add:

```html
<button id="dashboard-files-btn" class="btn btn-secondary btn-icon" type="button" title="File Browser">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
</button>
```

- [ ] **Step 6: Create file-browser.css**

Create `public/css/file-browser.css` with all styles for the file browser, editor, upload, directory picker, and context menu. Use CSS variables from `base.css` throughout. Key sections:

- `.file-browser-overlay` — full-screen overlay (position: fixed, inset: 0, z-index matching other overlays)
- `.fb-topbar` — top bar with back button, breadcrumb, menu
- `.fb-breadcrumb` — horizontally scrollable breadcrumb with tappable segments
- `.fb-actions` — quick action pills strip
- `.fb-pill` / `.fb-pill-accent` — pill button styles
- `.fb-file-list` — scrollable file list container
- `.fb-file-row` — individual file row with icon, name, meta, chevron
- `.fb-file-row.selected` — selected state (accent background tint)
- `.fb-context-menu` — floating context menu
- `.fb-context-backdrop` — dimmed backdrop behind context menu
- `.fb-selection-bar` — bottom action bar for multi-select
- `.fb-sel-action` — selection bar action buttons
- `.file-editor-overlay` — editor overlay
- `.fe-topbar` — editor top bar (accent border in edit mode via `.fe-editing`)
- `.fe-editor` — CodeMirror container (flex: 1 to fill remaining space)
- `.file-upload-overlay` — upload overlay
- `.fu-pond-container` — FilePond container
- `.dir-picker-overlay` — directory picker overlay
- `.dp-footer` — bottom bar with New Folder + confirm button

All overlays: `display: flex; flex-direction: column; background: var(--bg);`

- [ ] **Step 7: Verify HTML/CSS loads without errors**

```bash
PORT=7483 npm start &
sleep 2
# Open browser to http://localhost:7483 — check browser console for 404s or CSS errors
# All new CSS/JS files should load (even if empty/stub)
kill %1
```

- [ ] **Step 8: Commit HTML and CSS**

```bash
git add public/index.html public/css/file-browser.css
git commit -m "feat(file-browser): add HTML shell, overlays, and CSS styles

Add file browser, editor, upload, directory picker overlays to index.html.
Add file-browser.css with dark theme styles using CSS variables.
Add FilePond CDN and CodeMirror vendor script tags.
Add file browser icon buttons to terminal and dashboard views."
```

---

## Task 4: Frontend — File Browser Module

**Files:**
- Create: `public/js/file-browser.js`
- Modify: `public/js/app.js` (lines 12-15, 25-55, 202-208)
- Modify: `public/js/terminal-controls.js` (add click handler)
- Modify: `public/js/dashboard.js` (add click handler)

This is the largest frontend task. It implements the main file browser overlay with:
- Directory listing and navigation
- Breadcrumb path bar
- File icon mapping (vscode-icons-js)
- Context menu (long-press)
- Selection mode with action bar
- Directory picker for copy/move
- Sort toggle, hidden files toggle

- [ ] **Step 1: Create file-browser.js IIFE skeleton**

Create `public/js/file-browser.js` with the module structure, state management, and init/open/close functions:

```javascript
const FileBrowser = (() => {
  let _currentPath = '';
  let _history = [];
  let _selectionMode = false;
  let _selected = new Set();
  let _entries = [];
  let _sortBy = 'name';
  let _showHidden = false;
  let _contextTarget = null;
  let _originView = 'dashboard'; // 'dashboard' or 'terminal'

  // DOM references (set in init)
  let $overlay, $breadcrumb, $fileList, $selectionBar, $contextMenu, $contextBackdrop;

  function init() {
    $overlay = document.getElementById('file-browser-overlay');
    $breadcrumb = document.getElementById('fb-breadcrumb');
    $fileList = document.getElementById('fb-file-list');
    $selectionBar = document.getElementById('fb-selection-bar');
    $contextMenu = document.getElementById('fb-context-menu');
    $contextBackdrop = document.getElementById('fb-context-backdrop');

    // Back button
    document.getElementById('fb-back-btn').addEventListener('click', close);
    // Action pills
    document.getElementById('fb-upload-btn').addEventListener('click', () => FileUpload.open(_currentPath));
    document.getElementById('fb-mkdir-btn').addEventListener('click', promptMkdir);
    document.getElementById('fb-sort-btn').addEventListener('click', cycleSort);
    document.getElementById('fb-hidden-btn').addEventListener('click', toggleHidden);
    // Selection bar actions
    $selectionBar.addEventListener('click', handleSelectionAction);
    // Context menu backdrop
    $contextBackdrop.addEventListener('click', hideContextMenu);
    // File list delegation
    $fileList.addEventListener('click', handleFileClick);
    // Long-press for context menu
    setupLongPress();
  }

  async function open(initialPath) {
    _originView = window.location.hash.includes('terminal') ? 'terminal' : 'dashboard';
    const targetPath = initialPath || await getDefaultPath();
    _currentPath = targetPath;
    _history = [];
    _selectionMode = false;
    _selected.clear();
    $overlay.classList.remove('hidden');
    App.pushOverlay('file-browser', close);
    await refresh();
  }

  function close() {
    $overlay.classList.add('hidden');
    App.popOverlay('file-browser');
    exitSelectionMode();
    hideContextMenu();
  }

  // ... (remaining methods implemented in subsequent steps)

  return { init, open, close, refresh, downloadFile };
})();
```

- [ ] **Step 2: Add navigation, breadcrumb rendering, and API helpers**

Add to `file-browser.js` — API fetch helper, breadcrumb rendering, directory navigation:

```javascript
  async function api(endpoint, body = {}) {
    const res = await fetch(`/api/files/${endpoint}`, {
      method: endpoint === 'cwd' ? 'GET' : 'POST',
      headers: endpoint === 'cwd' ? {} : { 'Content-Type': 'application/json' },
      body: endpoint === 'cwd' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  async function getDefaultPath() {
    if (_originView === 'terminal') {
      const hash = window.location.hash;
      const sessionName = hash.split('/').slice(1).join('/');
      if (sessionName) {
        try {
          const res = await fetch(`/api/files/cwd?session=${encodeURIComponent(sessionName)}`);
          const data = await res.json();
          if (data.path) return data.path;
        } catch {}
      }
    }
    // Fallback: home directory
    const res = await api('list', { path: '~' }).catch(() => null);
    // Resolve ~ by listing home
    try {
      const cwdRes = await fetch('/api/files/cwd?session=_');
      const data = await cwdRes.json();
      return data.path; // Falls back to $HOME on server
    } catch {
      return '/home';
    }
  }

  function renderBreadcrumb() {
    const home = _currentPath.match(/^\/home\/[^/]+/)?.[0] || '';
    let display = _currentPath;
    if (home && _currentPath.startsWith(home)) {
      display = '~' + _currentPath.slice(home.length);
    }
    const parts = display.split('/').filter(Boolean);
    $breadcrumb.innerHTML = parts.map((part, i) => {
      const fullPath = display.startsWith('~')
        ? home + '/' + parts.slice(1, i + 1).join('/')
        : '/' + parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;
      return `<span class="fb-crumb${isLast ? ' fb-crumb-current' : ''}" data-path="${fullPath}">${part}</span>`;
    }).join('<span class="fb-crumb-sep">/</span>');
    $breadcrumb.scrollLeft = $breadcrumb.scrollWidth;
    // Click on breadcrumb segments
    $breadcrumb.querySelectorAll('.fb-crumb:not(.fb-crumb-current)').forEach(el => {
      el.addEventListener('click', () => navigateTo(el.dataset.path));
    });
  }

  async function navigateTo(dirPath) {
    _history.push(_currentPath);
    _currentPath = dirPath;
    exitSelectionMode();
    await refresh();
  }

  async function refresh() {
    try {
      _entries = await api('list', { path: _currentPath });
      renderBreadcrumb();
      renderFileList();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }
```

- [ ] **Step 3: Add file list rendering with vscode-icons**

Add to `file-browser.js` — renders the file list with icons from vscode-icons:

```javascript
  function getIconUrl(entry) {
    if (typeof getIconForFile === 'undefined' && typeof getIconForFolder === 'undefined') {
      // vscode-icons-js not loaded — fallback
      return entry.type === 'directory' ? '/icons/default_folder.svg' : '/icons/default_file.svg';
    }
    try {
      const iconName = entry.type === 'directory'
        ? (window.getIconForFolder ? getIconForFolder(entry.name) : 'default_folder.svg')
        : (window.getIconForFile ? getIconForFile(entry.name) : 'default_file.svg');
      return `/icons/${iconName}`;
    } catch {
      return entry.type === 'directory' ? '/icons/default_folder.svg' : '/icons/default_file.svg';
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  function renderFileList() {
    // Sort entries
    const sorted = [..._entries];
    if (_sortBy === 'date') sorted.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    else if (_sortBy === 'size') sorted.sort((a, b) => b.size - a.size);
    // Folders first is already handled by server, re-apply after sort
    sorted.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return 0;
    });

    $fileList.innerHTML = sorted.map(entry => {
      const iconUrl = getIconUrl(entry);
      const meta = entry.type === 'directory'
        ? `${formatDate(entry.modified)}`
        : `${formatSize(entry.size)} · ${formatDate(entry.modified)}`;
      const isSelected = _selected.has(entry.name);
      return `
        <div class="fb-file-row${isSelected ? ' selected' : ''}" data-name="${entry.name}" data-type="${entry.type}">
          ${_selectionMode ? `<div class="fb-checkbox${isSelected ? ' checked' : ''}">
            ${isSelected ? '✓' : ''}</div>` : ''}
          <img class="fb-file-icon" src="${iconUrl}" alt="" width="24" height="24">
          <div class="fb-file-info">
            <div class="fb-file-name">${entry.name}</div>
            <div class="fb-file-meta">${meta}</div>
          </div>
          <span class="fb-file-trail">${entry.type === 'directory' ? '›' : '⋮'}</span>
        </div>`;
    }).join('');

    // Update sort button text
    document.getElementById('fb-sort-btn').textContent =
      _sortBy === 'name' ? 'Sort ↕' : _sortBy === 'date' ? 'Date ↕' : 'Size ↕';
  }
```

- [ ] **Step 4: Add file click handling, context menu, and selection mode**

Add to `file-browser.js` — event handlers for tap, long-press, context menu, and selection:

```javascript
  function handleFileClick(e) {
    const row = e.target.closest('.fb-file-row');
    if (!row) return;
    const name = row.dataset.name;
    const type = row.dataset.type;

    if (_selectionMode) {
      toggleSelection(name);
      return;
    }

    const fullPath = _currentPath + '/' + name;
    if (type === 'directory') {
      navigateTo(fullPath);
    } else {
      FileEditor.open(fullPath);
    }
  }

  function setupLongPress() {
    let timer = null;
    let startX, startY;
    $fileList.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.fb-file-row');
      if (!row) return;
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        showContextMenu(row, e);
      }, 500);
    });
    $fileList.addEventListener('pointermove', (e) => {
      if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) {
        clearTimeout(timer);
        timer = null;
      }
    });
    $fileList.addEventListener('pointerup', () => { if (timer) clearTimeout(timer); timer = null; });
    $fileList.addEventListener('pointercancel', () => { if (timer) clearTimeout(timer); timer = null; });
  }

  function showContextMenu(row, e) {
    e.preventDefault();
    const name = row.dataset.name;
    const type = row.dataset.type;
    _contextTarget = { name, type, path: _currentPath + '/' + name };
    row.classList.add('context-active');

    const actions = [
      { label: 'Select', icon: '☐', action: 'select' },
      { label: 'Rename', icon: '✏️', action: 'rename' },
      { label: 'Copy', icon: '📋', action: 'copy' },
      { label: 'Move', icon: '📦', action: 'move' },
      { label: 'Download', icon: '↓', action: 'download' },
      { label: 'Info', icon: 'ℹ️', action: 'info' },
      { label: 'Delete', icon: '🗑', action: 'delete', danger: true },
    ];

    $contextMenu.innerHTML = actions.map(a =>
      `<div class="fb-ctx-item${a.danger ? ' fb-ctx-danger' : ''}" data-action="${a.action}">
        <span class="fb-ctx-icon">${a.icon}</span>
        <span>${a.label}</span>
      </div>`
    ).join('');

    // Position near the row
    const rect = row.getBoundingClientRect();
    $contextMenu.style.top = Math.min(rect.bottom, window.innerHeight - 350) + 'px';
    $contextMenu.style.left = '12px';
    $contextMenu.style.right = '12px';
    $contextMenu.classList.remove('hidden');
    $contextBackdrop.classList.remove('hidden');

    // Context menu click handler
    $contextMenu.onclick = (ev) => {
      const item = ev.target.closest('.fb-ctx-item');
      if (!item) return;
      handleContextAction(item.dataset.action);
    };
  }

  function hideContextMenu() {
    $contextMenu.classList.add('hidden');
    $contextBackdrop.classList.add('hidden');
    document.querySelectorAll('.fb-file-row.context-active').forEach(r => r.classList.remove('context-active'));
    _contextTarget = null;
  }

  async function handleContextAction(action) {
    const target = _contextTarget;
    hideContextMenu();
    if (!target) return;

    switch (action) {
      case 'select':
        enterSelectionMode(target.name);
        break;
      case 'rename':
        promptRename(target);
        break;
      case 'copy':
        DirPicker.open('Copy to...', 'Copy Here', async (destDir) => {
          const dest = destDir + '/' + target.name;
          try {
            await api('copy', { src: target.path, dest });
            App.toast('Copied');
            await refresh();
          } catch (err) {
            if (err.message === 'exists') {
              if (confirm(`"${target.name}" already exists. Replace?`)) {
                await api('copy', { src: target.path, dest, overwrite: true });
                App.toast('Copied (replaced)');
                await refresh();
              }
            } else { App.toast(err.message, 'error'); }
          }
        });
        break;
      case 'move':
        DirPicker.open('Move to...', 'Move Here', async (destDir) => {
          const dest = destDir + '/' + target.name;
          try {
            await api('move', { src: target.path, dest });
            App.toast('Moved');
            await refresh();
          } catch (err) {
            if (err.message === 'exists') {
              if (confirm(`"${target.name}" already exists. Replace?`)) {
                await api('move', { src: target.path, dest, overwrite: true });
                App.toast('Moved (replaced)');
                await refresh();
              }
            } else { App.toast(err.message, 'error'); }
          }
        });
        break;
      case 'download':
        downloadFile(target.path);
        break;
      case 'info':
        showFileInfo(target);
        break;
      case 'delete':
        if (confirm(`Delete "${target.name}"?`)) {
          try {
            await api('delete', { path: target.path });
            App.toast('Deleted');
            await refresh();
          } catch (err) { App.toast(err.message, 'error'); }
        }
        break;
    }
  }

  function enterSelectionMode(initialName) {
    _selectionMode = true;
    _selected.clear();
    if (initialName) _selected.add(initialName);
    renderFileList();
    updateSelectionBar();
    $selectionBar.classList.remove('hidden');
  }

  function exitSelectionMode() {
    _selectionMode = false;
    _selected.clear();
    $selectionBar.classList.add('hidden');
    renderFileList();
  }

  function toggleSelection(name) {
    if (_selected.has(name)) _selected.delete(name);
    else _selected.add(name);
    renderFileList();
    updateSelectionBar();
  }

  function updateSelectionBar() {
    // Update selection count in topbar could go here
  }

  async function handleSelectionAction(e) {
    const btn = e.target.closest('.fb-sel-action');
    if (!btn) return;
    const action = btn.dataset.action;
    const paths = [..._selected].map(name => _currentPath + '/' + name);

    switch (action) {
      case 'delete':
        if (!confirm(`Delete ${_selected.size} items?`)) return;
        for (const p of paths) {
          try { await api('delete', { path: p }); } catch {}
        }
        App.toast(`Deleted ${_selected.size} items`);
        exitSelectionMode();
        await refresh();
        break;
      case 'download':
        // For multiple files, download each (or could zip — future enhancement)
        for (const p of paths) downloadFile(p);
        break;
      case 'copy':
      case 'move':
        DirPicker.open(
          action === 'copy' ? 'Copy to...' : 'Move to...',
          action === 'copy' ? 'Copy Here' : 'Move Here',
          async (destDir) => {
            for (const p of paths) {
              const name = p.split('/').pop();
              const dest = destDir + '/' + name;
              try {
                await api(action, { src: p, dest });
              } catch (err) {
                if (err.message === 'exists') {
                  if (confirm(`"${name}" exists. Replace?`)) {
                    await api(action, { src: p, dest, overwrite: true });
                  }
                }
              }
            }
            App.toast(`${action === 'copy' ? 'Copied' : 'Moved'} ${_selected.size} items`);
            exitSelectionMode();
            await refresh();
          }
        );
        break;
    }
  }
```

- [ ] **Step 5: Add utility functions (mkdir prompt, rename, download, sort, hidden toggle, file info)**

Add to `file-browser.js`:

```javascript
  async function promptMkdir() {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      await api('mkdir', { path: _currentPath + '/' + name });
      App.toast('Folder created');
      await refresh();
    } catch (err) { App.toast(err.message, 'error'); }
  }

  async function promptRename(target) {
    const newName = prompt('Rename to:', target.name);
    if (!newName || newName === target.name) return;
    try {
      await api('rename', {
        oldPath: target.path,
        newPath: _currentPath + '/' + newName,
      });
      App.toast('Renamed');
      await refresh();
    } catch (err) {
      if (err.message.includes('exists')) App.toast('A file with that name already exists', 'error');
      else App.toast(err.message, 'error');
    }
  }

  function downloadFile(filePath) {
    // Use a hidden form POST to trigger download
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/files/download';
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'path';
    input.value = filePath;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  function cycleSort() {
    const order = ['name', 'date', 'size'];
    _sortBy = order[(order.indexOf(_sortBy) + 1) % order.length];
    renderFileList();
  }

  function toggleHidden() {
    _showHidden = !_showHidden;
    document.getElementById('fb-hidden-btn').classList.toggle('fb-pill-active', _showHidden);
    refresh();
  }

  function showFileInfo(target) {
    const entry = _entries.find(e => e.name === target.name);
    if (!entry) return;
    const info = [
      `Name: ${entry.name}`,
      `Type: ${entry.type}`,
      `Size: ${formatSize(entry.size)}`,
      `Modified: ${new Date(entry.modified).toLocaleString()}`,
      `Permissions: ${entry.permissions}`,
      `Path: ${target.path}`,
    ].join('\n');
    alert(info); // Simple for now — could be a proper modal later
  }
```

- [ ] **Step 6: Add DirPicker sub-module (directory picker for copy/move)**

Add to `file-browser.js` — the `DirPicker` internal object:

```javascript
  // Directory Picker (for copy/move destination)
  const DirPicker = (() => {
    let _dpPath = '';
    let _dpCallback = null;

    function open(title, confirmLabel, callback) {
      _dpPath = _currentPath;
      _dpCallback = callback;
      document.getElementById('dp-title').textContent = title;
      document.getElementById('dp-confirm-btn').textContent = confirmLabel;
      document.getElementById('dir-picker-overlay').classList.remove('hidden');
      App.pushOverlay('dir-picker', close);
      renderDirList();
    }

    function close() {
      document.getElementById('dir-picker-overlay').classList.add('hidden');
      App.popOverlay('dir-picker');
      _dpCallback = null;
    }

    async function renderDirList() {
      try {
        const entries = await api('list', { path: _dpPath });
        const dirs = entries.filter(e => e.type === 'directory');
        const $list = document.getElementById('dp-dir-list');
        $list.innerHTML = dirs.map(d => `
          <div class="fb-file-row" data-name="${d.name}" data-type="directory">
            <img class="fb-file-icon" src="${getIconUrl(d)}" width="24" height="24">
            <div class="fb-file-info"><div class="fb-file-name">${d.name}</div></div>
            <span class="fb-file-trail">›</span>
          </div>
        `).join('') || '<div class="fb-empty">No folders</div>';

        // Breadcrumb
        const $bc = document.getElementById('dp-breadcrumb');
        const home = _dpPath.match(/^\/home\/[^/]+/)?.[0] || '';
        let display = _dpPath;
        if (home && _dpPath.startsWith(home)) display = '~' + _dpPath.slice(home.length);
        $bc.textContent = display || '/';

        // Click handlers
        $list.onclick = (e) => {
          const row = e.target.closest('.fb-file-row');
          if (row) {
            _dpPath = _dpPath + '/' + row.dataset.name;
            renderDirList();
          }
        };
      } catch (err) {
        App.toast(err.message, 'error');
      }
    }

    // Wire up buttons
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('dp-close-btn')?.addEventListener('click', close);
      document.getElementById('dp-confirm-btn')?.addEventListener('click', () => {
        if (_dpCallback) _dpCallback(_dpPath);
        close();
      });
      document.getElementById('dp-mkdir-btn')?.addEventListener('click', async () => {
        const name = prompt('New folder name:');
        if (!name) return;
        try {
          await api('mkdir', { path: _dpPath + '/' + name });
          renderDirList();
        } catch (err) { App.toast(err.message, 'error'); }
      });
    });

    return { open, close };
  })();
```

- [ ] **Step 7: Integrate with app.js router**

In `public/js/app.js`:

1. Add to the views map (line 12-15):
   ```javascript
   files: () => document.getElementById('file-browser-overlay'),
   ```

2. In `handleRoute()` (around line 25-55), add handling for `#files`:
   ```javascript
   if (view === 'files') {
     const encodedPath = parts.slice(1).join('/');
     const initialPath = encodedPath ? decodeURIComponent(encodedPath) : null;
     FileBrowser.open(initialPath);
     return;
   }
   ```

3. In `init()` (around line 202-208), add:
   ```javascript
   FileBrowser.init();
   ```

- [ ] **Step 8: Wire up terminal-controls.js file browser button**

In `public/js/terminal-controls.js`, add a click handler for `#files-toggle-btn`:

```javascript
const filesBtn = document.getElementById('files-toggle-btn');
if (filesBtn) {
  filesBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    FileBrowser.open(); // Session-aware — will auto-detect CWD
  });
}
```

Add this in the initialization section (around line 30-60, near other button listeners).

- [ ] **Step 9: Wire up dashboard.js file browser button**

In `public/js/dashboard.js`, add a click handler for `#dashboard-files-btn`:

```javascript
const dashFilesBtn = document.getElementById('dashboard-files-btn');
if (dashFilesBtn) {
  dashFilesBtn.addEventListener('click', () => FileBrowser.open());
}
```

Add this in the initialization section.

- [ ] **Step 10: Verify file browser navigation**

Start the server, open the browser:
1. Click the file browser icon from dashboard — should open to home directory
2. Tap folders to navigate — breadcrumb should update
3. Tap breadcrumb segments to jump back
4. File icons should render (vscode-icons SVGs)
5. Long-press a file — context menu should appear
6. Tap "Select" — should enter selection mode

- [ ] **Step 11: Commit file browser module**

```bash
git add public/js/file-browser.js public/js/app.js public/js/terminal-controls.js public/js/dashboard.js
git commit -m "feat(file-browser): add main file browser module with navigation and context menu

IIFE module with directory listing, breadcrumb navigation, vscode-icons,
long-press context menu, selection mode with bulk actions, directory picker
for copy/move operations. Integrated with app.js router and menu bar buttons."
```

---

## Task 5: Frontend — File Editor Module

**Files:**
- Create: `public/js/file-editor.js`

- [ ] **Step 1: Create file-editor.js IIFE module**

Create `public/js/file-editor.js`:

```javascript
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
      App.toast(err.message, 'error');
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
      await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: _filePath, content }),
      });
      _originalContent = content;
      $modified.classList.add('hidden');
      App.toast('Saved');
      // Return to read-only
      _isEditing = false;
      $editBtn.classList.remove('hidden');
      $saveBtn.classList.add('hidden');
      $overlay.querySelector('.fe-topbar').classList.remove('fe-editing');
      createEditor(content, _filePath.split('/').pop(), false);
    } catch (err) {
      App.toast('Save failed: ' + err.message, 'error');
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
```

- [ ] **Step 2: Add FileEditor.init() call in app.js**

In `public/js/app.js` init function, after `FileBrowser.init()`:
```javascript
FileEditor.init();
```

- [ ] **Step 3: Verify editor**

Start server, navigate to file browser, tap a text file (e.g., package.json):
1. Should open in read-only mode with syntax highlighting
2. Tap Edit — should become editable, top bar turns green
3. Make a change — green dot appears
4. Tap Save — should save and return to read-only
5. Tap back with unsaved changes — should prompt confirmation

- [ ] **Step 4: Commit editor module**

```bash
git add public/js/file-editor.js public/js/app.js
git commit -m "feat(file-browser): add file editor with CodeMirror 6

Read-only view with syntax highlighting, edit mode toggle,
unsaved changes indicator, save to disk. Handles large files
and binary files gracefully."
```

---

## Task 6: Frontend — File Upload Module

**Files:**
- Create: `public/js/file-upload.js`

- [ ] **Step 1: Create file-upload.js IIFE module**

Create `public/js/file-upload.js`:

```javascript
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
          url: '/api/files/upload',
          method: 'POST',
          ondata: (formData) => {
            formData.append('targetDir', _targetDir);
            return formData;
          },
        },
      },
      labelIdle: 'Drag & drop files or <span class="filepond--label-action">Browse</span>',
      onprocessfiles: () => {
        App.toast('Upload complete');
      },
    });

    $overlay.classList.remove('hidden');
    App.pushOverlay('file-upload', close);
  }

  function close() {
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
```

- [ ] **Step 2: Add FileUpload.init() call in app.js**

In `public/js/app.js` init function, after `FileEditor.init()`:
```javascript
FileUpload.init();
```

- [ ] **Step 3: Update FileBrowser upload button to use FileUpload**

The upload button in `file-browser.js` already calls `FileUpload.open(_currentPath)`. Verify that the `onComplete` callback triggers a refresh:

```javascript
document.getElementById('fb-upload-btn').addEventListener('click', () => {
  FileUpload.open(_currentPath, () => FileBrowser.refresh());
});
```

Expose `refresh` from FileBrowser's return object if not already: `return { init, open, close, refresh, downloadFile };`

- [ ] **Step 4: Verify upload flow**

Start server, open file browser, click Upload:
1. FilePond overlay should appear
2. Pick files from phone/desktop
3. Progress bar should show
4. On completion, toast appears
5. Close overlay — file list should refresh showing new files

- [ ] **Step 5: Commit upload module**

```bash
git add public/js/file-upload.js public/js/app.js public/js/file-browser.js
git commit -m "feat(file-browser): add file upload with FilePond

Drag-and-drop upload overlay using FilePond CDN. Targets current
directory, handles multi-file uploads with progress bars.
Auto-refreshes file list on completion."
```

---

## Task 7: Polish & Integration Testing

**Files:**
- Various touch-ups across all new files

- [ ] **Step 1: Handle download endpoint for form POST**

The download endpoint uses `POST` with JSON body, but the `downloadFile()` function uses a hidden form. Update the download endpoint in `server/file-routes.js` to accept both JSON body and form-encoded body:

Add `express.urlencoded({ extended: false })` middleware to the download route, or switch to a GET endpoint with path as query param:

```javascript
  // Alternative: GET-based download
  app.get('/api/files/download', apiHandler(async (req, res) => {
    const filePath = await validatePath(req.query.path);
    // ... same download logic
  }));
```

Update `downloadFile()` in `file-browser.js` accordingly:
```javascript
  function downloadFile(filePath) {
    const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    a.click();
  }
```

- [ ] **Step 2: Add showHidden parameter to list endpoint**

Update the `/api/files/list` endpoint to accept a `showHidden` parameter from the request body, overriding the config default:

```javascript
const showHidden = req.body.showHidden !== undefined ? req.body.showHidden : config.showHiddenFiles;
if (!showHidden && entry.name.startsWith('.')) continue;
```

Update `refresh()` in `file-browser.js` to pass `_showHidden`:
```javascript
_entries = await api('list', { path: _currentPath, showHidden: _showHidden });
```

- [ ] **Step 3: Add FilePond dark theme overrides to file-browser.css**

FilePond ships with a light theme. Add CSS overrides in `file-browser.css`:

```css
/* FilePond dark theme */
.filepond--root { font-family: var(--sans); }
.filepond--panel-root { background-color: var(--surface); }
.filepond--drop-label { color: var(--text-dim); }
.filepond--label-action { color: var(--accent); }
.filepond--item-panel { background-color: var(--surface-raised); }
.filepond--file-action-button { color: var(--text); }
```

- [ ] **Step 4: End-to-end manual test checklist**

Test each flow from both phone and desktop:

1. **Dashboard → File Browser** — opens to home dir
2. **Terminal → File Browser** — opens to session CWD
3. **Navigate folders** — tap, breadcrumb updates
4. **Breadcrumb jump** — tap segment, jumps to that dir
5. **View file** — syntax highlighting, correct language
6. **Edit file** — edit mode, save, verify on disk
7. **Upload files** — FilePond, progress, file appears
8. **Download file** — triggers browser download
9. **Download folder** — downloads as zip
10. **New folder** — prompt, creates
11. **Rename** — prompt, renames
12. **Delete** — confirm, deletes
13. **Copy** — directory picker, copies
14. **Move** — directory picker, moves
15. **Long-press** — context menu appears
16. **Selection mode** — select multiple, bulk delete/download
17. **Back button** — returns to previous view correctly
18. **Path traversal** — `/etc` blocked with 403

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(file-browser): polish and integration fixes

Dark theme for FilePond, GET-based download endpoint,
showHidden parameter support, CSS refinements."
```

---

## Task 8: Documentation & Cleanup

**Files:**
- Modify: `CLAUDE.md` (update architecture docs)

- [ ] **Step 1: Update CLAUDE.md architecture section**

Add file browser to the Architecture section in `CLAUDE.md`:

Under `### Server (server/)`:
```
- **file-routes.js** — File browser REST API. All endpoints under `/api/files/*` — list, read, write, upload, download, mkdir, rename, delete, move, copy, cwd. Path traversal prevention via configurable allowed roots.
```

Under `### Frontend (public/)`:
```
- **file-browser.js** — File browser overlay with Google Files-style navigation, breadcrumbs, context menu, selection mode, directory picker
- **file-editor.js** — CodeMirror 6 wrapper for viewing/editing text files with syntax highlighting
- **file-upload.js** — FilePond wrapper for drag-and-drop file uploads
```

Update the dependency count from "3 npm dependencies" to "6 npm dependencies" (express, node-pty, ws, multer, archiver, vscode-icons-js).

- [ ] **Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with file browser architecture"
```
