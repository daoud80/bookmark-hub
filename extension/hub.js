'use strict';

const DEFAULTS = {
  title: 'Bookmark Hub',
  subtitle: '',
  accent: '#4f46e5',
  theme: 'system',
  newTab: false
};
const THEMES = ['system', 'light', 'dark'];
const NOTE_MAX = 300;

const state = {
  root: null,            // bookmarks tree root
  notes: {},             // { [url]: note }
  settings: { ...DEFAULTS },
  active: 'All',
  query: '',
  editing: null          // url being edited
};

const $ = (id) => document.getElementById(id);
const main = $('main'), chips = $('chips'), q = $('q'), count = $('count');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- storage ---------- */

async function loadStore() {
  const r = await chrome.storage.local.get(['settings', 'notes']);
  state.settings = sanitizeSettings(r.settings);
  state.notes = sanitizeNotes(r.notes);
}
const saveNotes = () => chrome.storage.local.set({ notes: state.notes });
const saveSettings = () => chrome.storage.local.set({ settings: state.settings });

function sanitizeSettings(s) {
  const out = { ...DEFAULTS };
  if (!s || typeof s !== 'object') return out;
  if (typeof s.title === 'string') out.title = s.title.slice(0, 60);
  if (typeof s.subtitle === 'string') out.subtitle = s.subtitle.slice(0, 100);
  if (typeof s.accent === 'string' && /^#[0-9a-f]{6}$/i.test(s.accent)) out.accent = s.accent.toLowerCase();
  if (THEMES.includes(s.theme)) out.theme = s.theme;
  if (typeof s.newTab === 'boolean') out.newTab = s.newTab;
  return out;
}

function sanitizeNotes(n) {
  const out = {};
  if (!n || typeof n !== 'object') return out;
  for (const [url, note] of Object.entries(n)) {
    if (typeof note === 'string' && note.trim()) out[url] = note.trim().slice(0, NOTE_MAX);
  }
  return out;
}

/* ---------- appearance ---------- */

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = s.theme;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--on-accent', readableOn(s.accent));
  $('title').textContent = s.title || DEFAULTS.title;
  $('subtitle').textContent = s.subtitle;
  document.title = s.title || DEFAULTS.title;
}

// white or near-black text, whichever reads better on the accent colour
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111111' : '#ffffff';
}

/* ---------- bookmarks ---------- */

// Sections follow the folder structure. The first root (the bookmarks/favourites bar) is shown
// without its own name; other roots (Other bookmarks, Mobile ...) keep theirs.
function buildSections(root) {
  const sections = new Map();
  const add = (path, node) => {
    if (!/^https?:\/\//i.test(node.url)) return;
    const key = path.join('\u0001');
    if (!sections.has(key)) sections.set(key, { path, items: [] });
    let host = '';
    try { host = new URL(node.url).hostname; } catch (_) { /* ignore */ }
    sections.get(key).items.push({ id: node.id, title: node.title || host || node.url, url: node.url, host });
  };
  const walk = (node, path) => {
    for (const c of node.children || []) {
      if (c.url) add(path, c);
      else walk(c, path.concat(c.title || 'Untitled folder'));
    }
  };
  (root.children || []).forEach((top, i) => walk(top, i === 0 ? [] : [top.title || 'Other']));
  return [...sections.values()];
}

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}

/* ---------- rendering ---------- */

function rootLabel() {
  const first = state.root && state.root.children && state.root.children[0];
  return (first && first.title) || 'Bookmarks bar';
}
const topOf = (sec) => sec.path[0] || rootLabel();
const labelOf = (sec) => (sec.path.length ? sec.path.join(' › ') : rootLabel());

function buildChips(sections) {
  const names = [...new Set(sections.map(topOf))];
  if (state.active !== 'All' && !names.includes(state.active)) state.active = 'All';
  const total = sections.reduce((a, s) => a + s.items.length, 0);
  chips.replaceChildren();
  const make = (name, n) => {
    const b = el('button', 'chip', `${name} · ${n}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(name === state.active));
    b.addEventListener('click', () => { state.active = name; render(); });
    chips.appendChild(b);
  };
  make('All', total);
  names.forEach((n) => make(n, sections.filter((s) => topOf(s) === n).reduce((a, s) => a + s.items.length, 0)));
}

function card(b) {
  const wrap = el('div', 'card');
  const a = el('a', 'link');
  a.href = b.url;
  if (state.settings.newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

  const tile = el('div', 'tile');
  const letter = () => { tile.textContent = (b.title.trim()[0] || '?').toUpperCase(); };
  const img = new Image();
  img.alt = ''; img.width = 24; img.height = 24; img.loading = 'lazy';
  img.addEventListener('error', letter);
  img.src = faviconUrl(b.url);
  tile.appendChild(img);

  const body = el('div');
  body.appendChild(el('div', 't', b.title));
  const note = state.notes[b.url];
  if (note) body.appendChild(el('div', 'd', note));
  body.appendChild(el('div', 'h', b.host));
  a.append(tile, body);

  const edit = el('button', 'edit', '✎');
  edit.type = 'button';
  edit.title = 'Edit note';
  edit.setAttribute('aria-label', `Edit note for ${b.title}`);
  edit.addEventListener('click', () => openEditor(b));

  wrap.append(a, edit);
  return wrap;
}

function render() {
  if (!state.root) return;
  const sections = buildSections(state.root);
  buildChips(sections);
  const term = state.query.trim().toLowerCase();
  main.replaceChildren();
  let shown = 0;
  for (const sec of sections) {
    if (state.active !== 'All' && topOf(sec) !== state.active) continue;
    const items = sec.items.filter((it) =>
      !term || `${it.title} ${state.notes[it.url] || ''} ${it.url}`.toLowerCase().includes(term));
    if (!items.length) continue;
    shown += items.length;
    const s = el('section');
    s.appendChild(el('h2', 'sec', labelOf(sec)));
    const g = el('div', 'grid');
    const frag = document.createDocumentFragment();
    items.forEach((it) => frag.appendChild(card(it)));
    g.appendChild(frag);
    s.appendChild(g);
    main.appendChild(s);
  }
  if (!shown) {
    main.appendChild(el('div', 'empty',
      term ? 'No bookmarks match your search.'
           : 'No bookmarks yet. Press Ctrl+D (or ⌘D) on any page and it will appear here.'));
  }
  count.textContent = `${shown} bookmark${shown === 1 ? '' : 's'}`;
}

/* ---------- live updates ---------- */

async function refresh() {
  const tree = await chrome.bookmarks.getTree();
  state.root = tree[0];
  render();
}
let timer = 0;
const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'].forEach((n) => {
  if (chrome.bookmarks[n]) chrome.bookmarks[n].addListener(scheduleRefresh);
});

/* ---------- note editor ---------- */

const editor = $('editor');
function openEditor(b) {
  state.editing = b.url;
  $('editorName').textContent = b.title;
  $('editorUrl').textContent = b.url;
  $('editorText').value = state.notes[b.url] || '';
  editor.showModal();
  $('editorText').focus();
}
async function commitNote(text) {
  const url = state.editing;
  if (!url) return;
  const v = text.trim().slice(0, NOTE_MAX);
  if (v) state.notes[url] = v; else delete state.notes[url];
  await saveNotes();
  state.editing = null;
  editor.close();
  render();
}
$('editorForm').addEventListener('submit', (e) => { e.preventDefault(); commitNote($('editorText').value); });
$('editorClear').addEventListener('click', () => commitNote(''));
$('editorCancel').addEventListener('click', () => { state.editing = null; editor.close(); });
$('editorText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote($('editorText').value); }
});

/* ---------- settings ---------- */

const settingsDlg = $('settings');
function fillSettings() {
  const s = state.settings;
  $('setTitle').value = s.title;
  $('setSubtitle').value = s.subtitle;
  $('setAccent').value = s.accent;
  $('setTheme').value = s.theme;
  $('setNewTab').checked = s.newTab;
  $('backupMsg').textContent = '';
}
$('settingsBtn').addEventListener('click', () => { fillSettings(); settingsDlg.showModal(); });
$('settingsForm').addEventListener('submit', (e) => { e.preventDefault(); settingsDlg.close(); });

async function onSettingChange() {
  state.settings = sanitizeSettings({
    title: $('setTitle').value.trim() || DEFAULTS.title,
    subtitle: $('setSubtitle').value.trim(),
    accent: $('setAccent').value,
    theme: $('setTheme').value,
    newTab: $('setNewTab').checked
  });
  applySettings();
  render();
  await saveSettings();
}
['setTitle', 'setSubtitle', 'setAccent', 'setTheme', 'setNewTab'].forEach((id) =>
  $(id).addEventListener(id === 'setTitle' || id === 'setSubtitle' ? 'input' : 'change', onSettingChange));

$('resetBtn').addEventListener('click', async () => {
  state.settings = { ...DEFAULTS };
  applySettings(); fillSettings(); render();
  await saveSettings();
});

$('exportBtn').addEventListener('click', () => {
  const data = { app: 'bookmark-hub', version: 1, settings: state.settings, notes: state.notes };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bookmark-hub-backup.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('backupMsg').textContent = 'Backup file downloaded.';
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('too large');
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'bookmark-hub') throw new Error('not a Bookmark Hub backup');
    const notes = sanitizeNotes(data.notes);
    state.notes = { ...state.notes, ...notes };
    if (data.settings) state.settings = sanitizeSettings(data.settings);
    await Promise.all([saveNotes(), saveSettings()]);
    applySettings(); fillSettings(); render();
    $('backupMsg').textContent = `Imported ${Object.keys(notes).length} notes.`;
  } catch (err) {
    $('backupMsg').textContent = 'Could not import that file.';
  }
});

/* ---------- search and keyboard ---------- */

q.addEventListener('input', () => { state.query = q.value; render(); });
q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; state.query = ''; render(); } });
addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); q.focus(); }
});

/* ---------- start ---------- */

(async function init() {
  await loadStore();
  applySettings();
  await refresh();
})();
