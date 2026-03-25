# File Browser — Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

A session-aware file browser overlay for TUI Browser that allows browsing, viewing, editing, uploading, and downloading files from any device. Accessible from the top menu bar alongside the existing notes icon.

### Use Cases

- Working on a project in a terminal session on your phone and need to upload a file to a specific directory
- Need to download or copy a large file created from a terminal session while on mobile
- Quick-edit a config file from your phone without needing a terminal command

### Entry Points

- **From terminal view:** Opens to the CWD of the current tmux session (via `tmux display -t :sessionName -p '#{pane_current_path}'`)
- **From dashboard view:** Opens to the user's home directory (`$HOME`)

## Architecture

Fully custom implementation — REST API backend + IIFE frontend module. No third-party file manager frameworks.

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `multer` | Multipart file upload handling | ~50KB |
| `archiver` | Zip generation for folder downloads | ~150KB |

### External Assets (CDN / Static)

| Asset | Purpose | Integration |
|-------|---------|-------------|
| **vscode-icons** | File/folder type icons (1,480 SVGs) | Copy SVGs to `public/icons/`, use `vscode-icons-js` mapping |
| **CodeMirror 6** | Text file viewing/editing with syntax highlighting | Pre-bundle once via esbuild, serve as static JS |
| **FilePond** | Upload widget with progress/queue UI | CDN (`<script>` + `<link>`) |

## Backend API

New file: `server/file-routes.js` — registered alongside existing `routes.js` in `server/index.js`.

All endpoints under `/api/files`. Every endpoint validates resolved paths stay within configured roots.

### Endpoints

| Endpoint | Method | Body | Response | Purpose |
|----------|--------|------|----------|---------|
| `/api/files/list` | POST | `{ path }` | `[{ name, type, size, modified, permissions }]` | List directory contents |
| `/api/files/read` | POST | `{ path }` | `{ content, encoding, size }` | Read text file contents |
| `/api/files/write` | POST | `{ path, content }` | `{ success }` | Save file contents |
| `/api/files/upload` | POST | multipart form data + `targetDir` field | `{ files: [{ name, size }] }` | Upload files via multer |
| `/api/files/download` | POST | `{ path }` | Binary stream (file or zip) | Download file or zip folder |
| `/api/files/mkdir` | POST | `{ path }` | `{ success }` | Create directory |
| `/api/files/rename` | POST | `{ oldPath, newPath }` | `{ success }` | Rename file or folder |
| `/api/files/delete` | POST | `{ path }` | `{ success }` | Delete file/folder (recursive for dirs) |
| `/api/files/move` | POST | `{ src, dest }` | `{ success }` | Move file/folder |
| `/api/files/copy` | POST | `{ src, dest }` | `{ success }` | Copy file/folder |
| `/api/files/cwd` | GET | `?session=name` | `{ path }` | Get CWD of a tmux session |

### Security

- **Path traversal prevention:** Every endpoint resolves the path with `path.resolve()` and verifies it starts with an allowed root. Symlinks resolved via `fs.realpath()` before checking.
- **Configurable roots:** Stored in `data/file-browser-config.json`. Default: `[ "$HOME" ]`. User can add additional allowed directories (e.g., `/mnt/data`, project paths).
- **Large file guard:** `/api/files/read` returns an error for files >1MB with the file size, so the frontend can offer download instead.
- **Binary detection:** `/api/files/read` checks for null bytes in the first 8KB to detect binary files and returns a `binary: true` flag instead of content.

## Frontend

### New Files

| File | Purpose |
|------|---------|
| `public/js/file-browser.js` | IIFE module — file list, navigation, context menu, selection mode |
| `public/js/file-editor.js` | IIFE module — CodeMirror 6 wrapper for viewing/editing files |
| `public/js/file-upload.js` | IIFE module — FilePond wrapper for upload UI |
| `public/css/file-browser.css` | Styles for file browser overlay, context menu, action bar |
| `public/icons/` | vscode-icons SVGs + icon mapping |
| `public/vendor/codemirror.bundle.js` | Pre-built CodeMirror 6 bundle |

### Module Structure

All modules follow the existing IIFE pattern (`const Module = (() => { ... })()`).

**FileBrowser** — main module:
- `init()` — register overlay, set up event listeners
- `open(initialPath?)` — open the file browser overlay at the given path
- `close()` — close the overlay, return to previous view

**FileEditor** — editor module:
- `open(filePath)` — fetch file content, render CodeMirror in read-only mode
- `enterEditMode()` — switch CodeMirror to editable
- `save()` — POST content back to server
- `close()` — tear down editor, return to file list

**FileUpload** — upload module:
- `open(targetDir)` — show FilePond upload overlay targeting the given directory
- `close()` — dismiss upload UI

### Layout

#### File Browser Overlay

```
┌─────────────────────────────────┐
│ ← │ ~/project/tui-browser      │ ⋮ │  ← Top bar: back + breadcrumb + menu
├─────────────────────────────────┤
│ [↑ Upload] [+ New Folder] [Sort ↕] │  ← Quick actions strip (scrollable pills)
├─────────────────────────────────┤
│ 📁 public          4 items · Mar 24 › │
│ 📁 server          8 items · Mar 25 › │
│ 📄 package.json    1.2 KB · Mar 22  ⋮ │  ← File list: folders first, then files
│ 📄 CLAUDE.md       3.8 KB · Mar 25  ⋮ │
│ 📄 install.sh      5.1 KB · Mar 18  ⋮ │
└─────────────────────────────────┘
```

- **Top bar:** Back arrow (returns to terminal/dashboard) + tappable breadcrumb path segments + overflow menu
- **Quick actions strip:** Horizontally scrollable pill buttons — Upload (accent green), New Folder, Sort toggle
- **File list:** Scrollable list. Each row: vscode-icon + filename + metadata (size, date) + chevron (folders) or menu (files)
- **Folders first**, then files. Both sorted by name (default), toggleable to date or size.

#### Breadcrumb Path

Each segment is tappable to navigate to that directory. On mobile with long paths, the breadcrumb scrolls horizontally. Home dir shown as `~`.

#### File Icons

vscode-icons SVGs served from `public/icons/`. Mapping via `vscode-icons-js` `getIconForFile(filename)` and `getIconForFolder(foldername)`. Falls back to `default_file.svg` / `default_folder.svg` for unknown types.

### Interactions

#### Tap

- **Folder:** Navigate into it (breadcrumb updates, file list refreshes)
- **Text file:** Open in FileEditor (read-only view)
- **Binary file:** Show file info (name, size, type, modified) with download button

#### Long-press → Context Menu

Floating menu appears below the pressed item with a dimmed backdrop:

1. **Select** — dismiss menu, enter multi-select mode with this item checked
2. **Rename** — inline rename input on the file row
3. **Copy** — enters "copy mode" (directory picker to choose destination)
4. **Move** — enters "move mode" (directory picker to choose destination)
5. **Download** — triggers file download (or zip for folders)
6. **Info** — shows file details (size, permissions, modified, full path)
7. **Delete** — confirmation dialog, then deletes (danger red)

#### Selection Mode

Triggered by tapping "Select" in the context menu:

- Checkboxes appear on all file rows
- The long-pressed item is pre-checked
- Tap rows to toggle selection
- Top bar changes: ✕ (exit) + "N selected" + "Select All" link
- Bottom action bar slides up: Copy, Move, Download, Delete
- ✕ or back button exits selection mode
- Delete always shows confirmation ("Delete 3 items?")
- Download zips multiple items into a single archive

### Editor View

#### Read-only Mode

```
┌─────────────────────────────────┐
│ ←  package.json        [Edit] [↓] │  ← Back + filename + Edit/Download buttons
│     1.2 KB · UTF-8 · JSON         │  ← File metadata subtitle
├─────────────────────────────────┤
│  1 │ {                             │
│  2 │   "name": "tui-browser",      │  ← CodeMirror 6 (read-only, syntax highlighted)
│  3 │   "version": "1.0.0",         │
│  ...                                │
└─────────────────────────────────┘
```

#### Edit Mode

```
┌─────────────────────────────────┐
│ ✕  package.json ● modified [Save] │  ← Cancel + modified indicator + Save button
│     Editing · JSON                  │
├─────────────────────────────────┤
│  1 │ {                             │
│  2 │   "name": "tui-browser",      │  ← CodeMirror 6 (editable, cursor active)
│  3 │   "version": "1.1.0"|         │
│  ...                                │
└─────────────────────────────────┘
```

- Tap **Edit** → switches CodeMirror to editable. Top bar border turns accent green. Save button appears.
- **● modified** indicator shows when content differs from saved version.
- **✕ (Cancel)** with unsaved changes → confirmation dialog: "Discard changes?"
- **Save** → POST to `/api/files/write`, toast on success, returns to read-only mode.
- **Large files (>1MB):** Warning before loading: "This file is large (X MB). Open anyway or download?"
- **Binary files:** Info screen with download button only — no editor.

### Upload Flow

1. Tap **Upload** pill in quick actions strip
2. FilePond overlay appears with drag-and-drop zone (opens native file picker on mobile)
3. Target directory is the currently browsed directory
4. Progress bars shown per file
5. On completion, file list auto-refreshes
6. Dismiss overlay to return to file browser

### Navigation Integration

#### Router

Add `files` to the `views` map in `app.js`:
- `#files` — opens file browser at context-appropriate path
- `#files/:encodedPath` — opens file browser at specific path

#### Overlay Stack

File browser registers with `App.pushOverlay()` / `App.popOverlay()` so the back button works correctly:
- From terminal: back returns to terminal
- From dashboard: back returns to dashboard
- Editor is a nested overlay: back returns to file browser

#### Menu Bar Icon

Add a folder icon button to the top menu bar in terminal view (alongside notes, text-select, etc.) and a separate icon on the dashboard view.

## Configuration

Stored in `data/file-browser-config.json`:

```json
{
  "allowedRoots": ["$HOME"],
  "showHiddenFiles": false,
  "defaultSort": "name",
  "maxFileSize": 1048576
}
```

- `allowedRoots` — directories the file browser can access. `$HOME` expanded at runtime.
- `showHiddenFiles` — whether to show dotfiles by default (toggleable in UI via overflow menu)
- `defaultSort` — "name", "date", or "size"
- `maxFileSize` — max bytes for in-browser text viewing (default 1MB)

## Deferred to Future Versions

- **Search:** File name search within directory tree
- **Rich previews:** Image viewer, PDF viewer, rendered markdown
- **Clipboard integration:** "Copy path" action, paste path into terminal
- **Favorites/bookmarks:** Pin frequently accessed directories
- **Git status indicators:** Show modified/untracked file markers
- **Drag-and-drop reordering:** Move files by dragging within the list
