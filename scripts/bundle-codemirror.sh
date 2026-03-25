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

# Create entry point in project dir so esbuild can resolve node_modules
cat > .cm-entry.js << 'ENTRY'
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
npx esbuild .cm-entry.js \
  --bundle \
  --format=iife \
  --minify \
  --outfile=public/vendor/codemirror.bundle.js

rm .cm-entry.js
echo "Built: public/vendor/codemirror.bundle.js ($(wc -c < public/vendor/codemirror.bundle.js) bytes)"
