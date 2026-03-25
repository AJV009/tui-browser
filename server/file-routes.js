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
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Path is required');
  }
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

function setup(app) {
  // List directory contents
  app.post('/api/files/list', apiHandler(async (req, res) => {
    const dirPath = await validatePath(req.body.path);
    const config = loadConfig();
    const showHidden = req.body.showHidden != null ? req.body.showHidden : config.showHiddenFiles;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!showHidden && entry.name.startsWith('.')) continue;
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
    if (typeof req.body.content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    await fs.writeFile(filePath, req.body.content, 'utf8');
    res.json({ success: true });
  }));

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
    const roots = getAllowedRoots();
    if (roots.includes(oldPath)) {
      return res.status(403).json({ error: 'Cannot rename a root directory' });
    }
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
    const roots = getAllowedRoots();
    if (roots.includes(filePath)) {
      return res.status(403).json({ error: 'Cannot delete a root directory' });
    }
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    res.json({ success: true });
  }));

  // Move file or folder
  app.post('/api/files/move', apiHandler(async (req, res) => {
    const src = await validatePath(req.body.src);
    const dest = await validatePath(req.body.dest);
    const roots = getAllowedRoots();
    if (roots.includes(src)) {
      return res.status(403).json({ error: 'Cannot move a root directory' });
    }
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

  // Upload files
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const dir = await validatePath(req.body.targetDir || req.query.targetDir);
        req._validatedDir = dir;
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      // Handle conflicts: append (1), (2) etc.
      const dir = req._validatedDir;
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

  // Get CWD of a tmux session
  const { exec: run } = require('./exec-util');

  app.get('/api/files/cwd', apiHandler(async (req, res) => {
    const session = req.query.session;
    if (!session) return res.status(400).json({ error: 'session parameter required' });
    try {
      const cwd = await run('tmux', ['display', '-t', session, '-p', '#{pane_current_path}']);
      const trimmed = cwd.trim();
      if (trimmed) {
        res.json({ path: trimmed });
      } else {
        res.json({ path: os.homedir() });
      }
    } catch {
      // Fallback to home directory
      res.json({ path: os.homedir() });
    }
  }));
}

module.exports = { setup };
