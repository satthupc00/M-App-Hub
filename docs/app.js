/* M AppHub — dashboard quản lý app trên GitHub. Vanilla JS, không framework. */
(() => {
'use strict';
const OWNER = 'satthupc00', SELF_REPO = 'M-App-Hub';
const API = new URLSearchParams(location.search).get('api') || 'https://api.github.com'; // ?api= chỉ dùng khi test
const CACHE_TTL = 30 * 60 * 1000;           // tự tải lại nếu dữ liệu cũ hơn 30 phút
const NEW_DAYS = 3;                          // viền xanh nếu bản mới ra trong 3 ngày
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isElectron = !!window.mah?.isElectron;
if (isElectron) document.documentElement.classList.add('electron');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- lưu trữ ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('mah.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mah.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('mah.' + k); } catch {} }
};
const S = {
  groups: store.get('groups', [{ id: 'g1', name: 'App lớn' }, { id: 'g2', name: 'App nhỏ' }]),
  assign: store.get('assign', {}),        // repo -> groupId
  order: store.get('order', {}),          // groupId|'none' -> [repo,...]
  overrides: store.get('overrides', {}),  // repo -> {name, desc}
  hidden: store.get('hidden', []),
  token: store.get('token', ''),
  cache: store.get('cache', null),        // {ts, repos:[...]}
  sel: store.get('sel', 'all'),           // 'all' | groupId | 'none' | 'hidden'
  q: ''
};
const save = k => store.set(k, S[k]);

/* ---------- GitHub ---------- */
function headers() {
  const h = { Accept: 'application/vnd.github+json' };
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  return h;
}
async function gh(path) {
  const r = await fetch(API + path, { headers: headers() });
  if (r.status === 404) return null;
  if (!r.ok) {
    const remaining = r.headers.get('x-ratelimit-remaining'), reset = +r.headers.get('x-ratelimit-reset') * 1000;
    if ((r.status === 403 || r.status === 429) && remaining === '0') {
      const min = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
      throw new Error(`GitHub giới hạn lượt tải. Thử lại sau ${min} phút` + (S.token ? '' : ' (dán token trong Cài đặt để tăng giới hạn)'));
    }
    if (r.status === 401) throw new Error('Token GitHub không hợp lệ. Kiểm tra lại trong Cài đặt');
    throw new Error('Lỗi GitHub ' + r.status);
  }
  return r.json();
}
function platformsOf(assets) {
  const set = new Set();
  for (const a of assets || []) {
    const n = (a.name || '').toLowerCase();
    if (/\.apk$|\.aab$/.test(n)) set.add('Android');
    else if (/\.exe$|\.msi$|\.msix$|\.appx$|win|windows|setup/.test(n) || /\.nupkg$/.test(n)) set.add('PC');
    else if (/\.dmg$|\.pkg$|mac|darwin/.test(n)) set.add('Mac');
    else if (/\.deb$|\.rpm$|\.appimage$|linux/.test(n)) set.add('Linux');
    else if (/\.zip$|\.7z$|\.rar$/.test(n)) set.add('PC');
  }
  return [...set];
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
async function fetchAll(force) {
  const old = S.cache?.repos || [];
  const oldBy = Object.fromEntries(old.map(r => [r.name, r]));
  const list = S.token
    ? await gh(`/user/repos?per_page=100&affiliation=owner&sort=pushed`)
    : await gh(`/users/${OWNER}/repos?per_page=100&sort=pushed`);
  const repos = (list || []).filter(r => r.owner?.login?.toLowerCase() === OWNER.toLowerCase());
  const result = await mapLimit(repos, 6, async r => {
    const prev = oldBy[r.name];
    const base = { name: r.name, full: r.full_name, desc: r.description || '', private: !!r.private, pushed: r.pushed_at, url: r.html_url, archived: !!r.archived };
    // Repo chưa có gì mới kể từ lần tải trước → dùng lại thông tin bản phát hành (tiết kiệm lượt gọi)
    if (!force && prev && prev.pushed === r.pushed_at && prev.rel !== undefined) return { ...base, rel: prev.rel };
    let rel = null;
    try {
      const lr = await gh(`/repos/${r.full_name}/releases/latest`);
      if (lr) rel = { tag: lr.tag_name, date: lr.published_at, platforms: platformsOf(lr.assets), url: lr.html_url };
      else {
        const tags = await gh(`/repos/${r.full_name}/tags?per_page=1`);
        if (tags && tags[0]) rel = { tag: tags[0].name, date: null, platforms: [], url: null };
      }
    } catch (e) { if (prev) return { ...base, rel: prev.rel }; throw e; }
    return { ...base, rel };
  });
  S.cache = { ts: Date.now(), repos: result };
  save('cache');
}

/* ---------- trạng thái tải ---------- */
let loading = false;
function setDot(state, title) {
  for (const d of [$('#dot'), $('#mdot')]) { d.className = 'syncdot ' + state; d.title = title; d.setAttribute('aria-label', 'Tải dữ liệu: ' + title); }
}
async function reload(force) {
  if (loading) return;
  loading = true; setDot('busy', 'Đang tải danh sách từ GitHub…');
  try {
    await fetchAll(force);
    setDot('ok', 'Đã tải từ GitHub · ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    render();
  } catch (e) {
    setDot('err', 'Lỗi: ' + e.message);
    toast(e.message);
    render();
  } finally { loading = false; }
}

/* ---------- tiện ích ---------- */
const COLORS = ['#3D6BFF', '#7B5CFF', '#22A6C3', '#1FA463', '#D9822B', '#B8456E', '#5B8DEF', '#7E57C2', '#2E8B8B', '#C2553D'];
const colorOf = s => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
function prettyName(repo) { return repo.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function dispName(r) { return S.overrides[r.name]?.name || prettyName(r.name); }
function dispDesc(r) { return S.overrides[r.name]?.desc ?? r.desc; }
function ago(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'vừa xong';
  if (d < 3600) return Math.floor(d / 60) + ' phút trước';
  if (d < 86400) return Math.floor(d / 3600) + ' giờ trước';
  if (d < 86400 * 2) return 'hôm qua';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' ngày trước';
  if (d < 86400 * 30) return Math.floor(d / 86400 / 7) + ' tuần trước';
  if (d < 86400 * 365) return Math.floor(d / 86400 / 30) + ' tháng trước';
  return Math.floor(d / 86400 / 365) + ' năm trước';
}
const isNew = iso => iso && (Date.now() - new Date(iso)) < NEW_DAYS * 86400000;
function groupOf(repo) { const g = S.assign[repo]; return g && S.groups.some(x => x.id === g) ? g : 'none'; }
function visibleRepos() {
  let list = (S.cache?.repos || []).filter(r => r.name !== SELF_REPO);
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter(r => dispName(r).toLowerCase().includes(q) || (dispDesc(r) || '').toLowerCase().includes(q) || r.name.toLowerCase().includes(q)); }
  return list;
}
function sortByOrder(list, key) {
  const ord = S.order[key] || [];
  const idx = n => { const i = ord.indexOf(n); return i < 0 ? 1e9 : i; };
  return list.slice().sort((a, b) => idx(a.name) - idx(b.name) || new Date(b.pushed) - new Date(a.pushed));
}

/* ---------- render ---------- */
const PF_ICON = { PC: 'i-monitor', Android: 'i-phone', Mac: 'i-monitor', Linux: 'i-monitor', Web: 'i-globe' };
function rowHTML(r) {
  const name = dispName(r), desc = dispDesc(r), rel = r.rel;
  const hid = S.hidden.includes(r.name);
  const ver = rel ? `<span class="ver ${isNew(rel.date) ? 'new' : ''}" title="${rel.date ? 'Phát hành ' + new Date(rel.date).toLocaleDateString('vi-VN') : 'Tag mới nhất'}">${esc(rel.tag)}</span>`
                  : `<span class="ver none">chưa có bản</span>`;
  const pf = rel?.platforms?.length ? `<span class="pf">${rel.platforms.map(p => `<span><svg><use href="#${PF_ICON[p] || 'i-monitor'}"/></svg>${p}</span>`).join('')}</span>` : '';
  return `<div class="row ${hid ? 'hid' : ''}" data-repo="${esc(r.name)}" tabindex="0" title="${esc(name)}">
    <div class="chip" style="background:${colorOf(r.name)}">${esc(name[0].toUpperCase())}</div>
    <div><div class="nm"><span>${esc(name)}</span>${r.private ? '<svg><use href="#i-lock"/></svg>' : ''}</div><div class="ds">${esc(desc) || '<i>Chưa có mô tả</i>'}</div></div>
    <div class="meta"><div class="vl">${pf}${ver}</div><span class="when">${rel?.date ? ago(rel.date) : (rel ? '' : 'cập nhật ' + ago(r.pushed))}</span></div>
  </div>`;
}
function render() {
  renderGroups();
  const main = $('#main'); const all = visibleRepos();
  const hiddenN = all.filter(r => S.hidden.includes(r.name)).length;
  if (!S.cache) {
    main.innerHTML = `<div class="empty fx-rise"><h2>Chưa có dữ liệu</h2><div>Nhấn nút mây để tải danh sách app từ GitHub của ${OWNER}.</div>
      <div class="keys"><span><kbd>F5</kbd> tải lại</span><span><kbd>Ctrl</kbd>+<kbd>F</kbd> tìm</span></div></div>`;
    $('#stat').textContent = ''; return;
  }
  let html = '';
  const section = (label, list, key) => {
    if (!list.length) return;
    html += `<div class="sec">${esc(label)} · ${list.length}</div><div class="list" data-key="${esc(key)}">${sortByOrder(list, key).map(rowHTML).join('')}</div>`;
  };
  const shown = all.filter(r => !S.hidden.includes(r.name));
  if (S.sel === 'all') {
    for (const g of S.groups) section(g.name, shown.filter(r => groupOf(r.name) === g.id), g.id);
    section('Chưa phân nhóm', shown.filter(r => groupOf(r.name) === 'none'), 'none');
  } else if (S.sel === 'hidden') {
    section('Đã ẩn', all.filter(r => S.hidden.includes(r.name)), 'hidden');
  } else if (S.sel === 'none') {
    section('Chưa phân nhóm', shown.filter(r => groupOf(r.name) === 'none'), 'none');
  } else {
    const g = S.groups.find(x => x.id === S.sel);
    if (g) section(g.name, shown.filter(r => groupOf(r.name) === g.id), g.id);
  }
  if (!html) html = `<div class="empty fx-rise"><h2>${S.q ? 'Không tìm thấy app nào' : 'Trống'}</h2><div>${S.q ? 'Thử từ khóa khác.' : 'Chuột phải vào một app (hoặc giữ lâu trên điện thoại) để đưa vào nhóm này.'}</div></div>`;
  main.innerHTML = html;
  $('#stat').textContent = `${shown.length} app · ${S.groups.length} nhóm` + (hiddenN ? ` · ${hiddenN} đã ẩn` : '') + (S.cache ? ` · đã tải ${ago(new Date(S.cache.ts).toISOString())}` : '');
}
function renderGroups() {
  const all = (S.cache?.repos || []).filter(r => r.name !== SELF_REPO);
  const shown = all.filter(r => !S.hidden.includes(r.name));
  const cnt = id => id === 'all' ? shown.length : id === 'hidden' ? all.length - shown.length : shown.filter(r => groupOf(r.name) === id).length;
  const items = [['all', 'Tất cả'], ...S.groups.map(g => [g.id, g.name]), ['none', 'Chưa phân nhóm']];
  if (cnt('hidden')) items.push(['hidden', 'Đã ẩn']);
  $('#side').innerHTML = `<h4>Nhóm</h4>` + items.map(([id, nm]) =>
    `<button type="button" class="grp ${S.sel === id ? 'sel' : ''} ${id === 'hidden' || id === 'none' ? 'dim' : ''}" data-g="${esc(id)}">${esc(nm)}<span class="n">${cnt(id)}</span></button>`).join('')
    + `<button type="button" class="grp add" id="addGroup"><svg><use href="#i-plus"/></svg>Thêm nhóm</button>`;
  $('#chips').innerHTML = items.map(([id, nm]) => `<button type="button" class="${S.sel === id ? 'sel' : ''}" data-g="${esc(id)}">${esc(nm)} · ${cnt(id)}</button>`).join('')
    + `<button type="button" class="add" id="addGroupM">+ Nhóm</button>`;
}

/* ---------- menu ngữ cảnh ---------- */
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(x, y, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') { m.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); continue; }
    if (it.label) { m.insertAdjacentHTML('beforeend', `<div class="lbl">${esc(it.label)}</div>`); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.className = it.on ? 'on' : '';
    b.innerHTML = (it.icon ? `<svg><use href="#${it.icon}"/></svg>` : '') + esc(it.text);
    b.onclick = () => { closeMenu(); it.run(); };
    m.appendChild(b);
  }
  document.body.appendChild(m); menuEl = m;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') { if (drag?.active) { endDrag(null, true); return; } if (menuEl || dlgEl) { closeMenu(); closeDialog(); return; } hideToast(); if ($('#mstrip').classList.contains('searching')) closeMSearch(); } });
addEventListener('blur', closeMenu);

function repoMenu(repo, x, y) {
  const r = (S.cache?.repos || []).find(z => z.name === repo); if (!r) return;
  const cur = groupOf(repo), hid = S.hidden.includes(repo);
  const items = [{ label: dispName(r) }];
  if (!hid) {
    items.push({ label: 'Đưa vào nhóm' });
    for (const g of S.groups) items.push({ text: g.name, icon: cur === g.id ? 'i-check' : 'i-folder', on: cur === g.id, run: () => moveTo(repo, g.id) });
    items.push({ text: 'Chưa phân nhóm', icon: cur === 'none' ? 'i-check' : 'i-folder', on: cur === 'none', run: () => moveTo(repo, 'none') });
    items.push({ text: 'Nhóm mới…', icon: 'i-plus', run: () => addGroup(repo) });
    items.push('-');
    items.push({ text: 'Sửa tên / mô tả…', icon: 'i-edit', run: () => editRepo(repo) });
    items.push({ text: 'Ẩn app', icon: 'i-eyeoff', run: () => { S.hidden.push(repo); save('hidden'); render(); toast('Đã ẩn ' + dispName(r), { undo: () => { S.hidden = S.hidden.filter(n => n !== repo); save('hidden'); render(); } }); } });
  } else {
    items.push({ text: 'Hiện lại app', icon: 'i-eye', run: () => { S.hidden = S.hidden.filter(n => n !== repo); save('hidden'); render(); } });
  }
  openMenu(x, y, items);
}
function moveTo(repo, gid) {
  if (gid === 'none') delete S.assign[repo]; else S.assign[repo] = gid;
  save('assign'); render();
}
function groupMenu(gid, x, y) {
  const g = S.groups.find(z => z.id === gid); if (!g) return;
  openMenu(x, y, [{ label: g.name },
    { text: 'Đổi tên…', icon: 'i-edit', run: () => renameGroup(gid) },
    { text: 'Xóa nhóm', icon: 'i-trash', run: () => { 
        S.groups = S.groups.filter(z => z.id !== gid); for (const k in S.assign) if (S.assign[k] === gid) delete S.assign[k];
        if (S.sel === gid) S.sel = 'all'; save('groups'); save('assign'); save('sel'); render(); toast('Đã xóa nhóm ' + g.name + ' (app chuyển về Chưa phân nhóm)'); } }]);
}

/* ---------- dialog ---------- */
let dlgEl = null;
function closeDialog() { if (dlgEl) { dlgEl.remove(); dlgEl = null; } }
function dialog(title, bodyHTML, { icon, footer = '', onOpen } = {}) {
  closeDialog();
  const b = document.createElement('div'); b.className = 'backdrop' + (isElectron ? ' drag' : '');
  b.innerHTML = `<div class="dlg" role="dialog" aria-label="${esc(title)}"><h3>${icon ? `<svg><use href="#${icon}"/></svg>` : ''}${esc(title)}<button type="button" class="x" title="Đóng (Esc)" aria-label="Đóng"><svg><use href="#i-x"/></svg></button></h3>
    <div class="bd">${bodyHTML}</div>${footer ? `<div class="ft">${footer}</div>` : ''}</div>`;
  b.addEventListener('pointerdown', e => { if (e.target === b) closeDialog(); });
  $('.x', b).onclick = closeDialog;
  document.body.appendChild(b); dlgEl = b;
  onOpen?.(b);
  const f = $('input,button.pri', b); if (f) setTimeout(() => f.focus(), 50);
  return b;
}
function prompt1(title, label, value, onOk, placeholder = '') {
  dialog(title, `<div class="field"><label>${esc(label)}</label><input id="pv" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60"></div>`,
    { footer: `<button type="button" class="btn" id="pc">Hủy</button><button type="button" class="btn pri" id="pok">Lưu</button>`,
      onOpen: b => { const ok = () => { const v = $('#pv', b).value.trim(); if (!v) return; closeDialog(); onOk(v); };
        $('#pok', b).onclick = ok; $('#pc', b).onclick = closeDialog; $('#pv', b).onkeydown = e => { if (e.key === 'Enter') ok(); }; } });
}
function addGroup(repoToMove) {
  prompt1('Nhóm mới', 'Tên nhóm', '', name => {
    const g = { id: 'g' + Date.now().toString(36), name }; S.groups.push(g); save('groups');
    if (repoToMove) moveTo(repoToMove, g.id); else render();
  }, 'vd: App lớn');
}
function renameGroup(gid) { const g = S.groups.find(z => z.id === gid); prompt1('Đổi tên nhóm', 'Tên nhóm', g.name, v => { g.name = v; save('groups'); render(); }); }
function editRepo(repo) {
  const r = S.cache.repos.find(z => z.name === repo);
  dialog('Sửa tên / mô tả', `<div class="field"><label>Tên hiển thị</label><input id="en" value="${esc(dispName(r))}" maxlength="60"></div>
    <div class="field"><label>Mô tả 1 dòng</label><input id="ed" value="${esc(dispDesc(r))}" maxlength="120" placeholder="${esc(r.desc || 'Chưa có mô tả trên GitHub')}"></div>
    <div class="note">Chỉ đổi cách hiển thị trong app này, không đổi gì trên GitHub. Repo: ${esc(r.full)}</div>`,
    { icon: 'i-edit', footer: `<button type="button" class="btn" id="er">Dùng lại từ GitHub</button><button type="button" class="btn pri" id="eok">Lưu</button>`,
      onOpen: b => {
        $('#eok', b).onclick = () => { const n = $('#en', b).value.trim(), d = $('#ed', b).value.trim();
          S.overrides[repo] = { name: n || prettyName(repo), desc: d }; save('overrides'); closeDialog(); render(); };
        $('#er', b).onclick = () => { delete S.overrides[repo]; save('overrides'); closeDialog(); render(); };
        $$('input', b).forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('#eok', b).click(); });
      } });
}

/* ---------- cài đặt + what's new ---------- */
function openSettings() {
  dialog('Cài đặt', `
    <div class="sect">Phiên bản</div>
    <div class="vline"><span class="v">v${esc(APP_VERSION)}</span><span id="sUpdState" class="note"></span></div>
    <div class="vline"><button type="button" class="btn" id="sCheck"><svg><use href="#i-refresh"/></svg>Kiểm tra cập nhật</button>
      <button type="button" class="btn" id="sWhatsNew"><svg><use href="#i-sparkles"/></svg>What's new</button></div>
    <div class="sect">GitHub</div>
    <div class="field"><label>Token GitHub (tùy chọn — chỉ cần nếu muốn hiện repo private, hoặc tải lại nhiều lần trong 1 giờ)</label>
      <div class="row2"><input id="sTok" type="password" value="${esc(S.token)}" placeholder="ghp_… hoặc github_pat_…" autocomplete="off"><button type="button" class="btn" id="sTokEye" title="Hiện/ẩn"><svg><use href="#i-eye"/></svg></button></div></div>
    <div class="note">Token được lưu trên máy này, chỉ dùng để gọi GitHub. Tạo tại GitHub → Settings → Developer settings → Personal access tokens (quyền đọc repo là đủ).</div>
    <div class="sect">Dữ liệu</div>
    <div class="vline"><button type="button" class="btn" id="sForce"><svg><use href="#i-cloud"/></svg>Tải lại toàn bộ</button>
      <button type="button" class="btn dng" id="sReset"><svg><use href="#i-trash"/></svg>Xóa nhóm & tùy chỉnh</button></div>
    <div class="note">Tải lại toàn bộ: bỏ qua dữ liệu tạm, hỏi lại GitHub từng app (tốn nhiều lượt gọi hơn).</div>`,
    { icon: 'i-settings', footer: `<button type="button" class="btn pri" id="sSave">Lưu</button>`,
      onOpen: b => {
        $('#sSave', b).onclick = () => { const t = $('#sTok', b).value.trim(); const changed = t !== S.token; S.token = t; save('token'); closeDialog(); if (changed) reload(true); };
        $('#sTokEye', b).onclick = () => { const i = $('#sTok', b); i.type = i.type === 'password' ? 'text' : 'password'; };
        $('#sCheck', b).onclick = () => checkUpdate(true);
        $('#sWhatsNew', b).onclick = openWhatsNew;
        $('#sForce', b).onclick = () => { closeDialog(); reload(true); };
        $('#sReset', b).onclick = () => { if (!confirm('Xóa toàn bộ nhóm, tên/mô tả đã sửa và danh sách ẩn?')) return;
          S.groups = [{ id: 'g1', name: 'App lớn' }, { id: 'g2', name: 'App nhỏ' }]; S.assign = {}; S.order = {}; S.overrides = {}; S.hidden = []; S.sel = 'all';
          ['groups', 'assign', 'order', 'overrides', 'hidden', 'sel'].forEach(save); closeDialog(); render(); toast('Đã đặt lại nhóm & tùy chỉnh'); };
        $('#sUpdState', b).textContent = updState.text || '';
      } });
}
async function openWhatsNew() {
  let w = null; try { w = await (await fetch('whatsnew.json', { cache: 'no-store' })).json(); } catch {}
  if (!w) return toast('Không đọc được bảng thay đổi');
  const sec = (t, cls, arr) => arr?.length ? `<h4><span class="tag ${cls}">${t}</span></h4><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const d = w.date ? new Date(w.date).toLocaleDateString('vi-VN') : '';
  dialog("What's new", `<div class="wn"><div class="vline"><span class="v">v${esc(w.version)}</span><span class="note">${d}</span></div>
    ${sec('Mới', 'n', w.new)}${sec('Cải thiện', 'i', w.improved)}${sec('Sửa lỗi', 'f', w.fixed)}
    ${updState.available ? `<div class="note" style="margin-top:10px">Có bản mới v${esc(updState.available)}. <button type="button" class="btn pri" id="wnUpd" style="margin-left:6px">Cập nhật</button></div>` : ''}</div>`,
    { icon: 'i-sparkles', onOpen: b => { const u = $('#wnUpd', b); if (u) u.onclick = () => { closeDialog(); applyUpdate(); }; } });
}

/* ---------- kiểm tra cập nhật ---------- */
const updState = { text: '', available: null, downloaded: false, checking: false };
function semverGt(a, b) { const p = s => String(s).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0); const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
function setUpdUI(cls, title) {
  for (const b of [$('#btnUpd'), $('#mbtnUpd')]) { b.className = 'ibtn upd ' + cls; b.title = 'Kiểm tra cập nhật' + (title ? ' · ' + title : ''); b.setAttribute('aria-label', b.title); }
  const isLatest = cls === 'ok';
  $('#latestBadge').hidden = !isLatest; $('#mlatestBadge').hidden = !isLatest;
  updState.text = title; const s = $('#sUpdState'); if (s) s.textContent = title;
}
let latestRelease = null;
async function checkUpdate(manual) {
  if (updState.checking) return; updState.checking = true; setUpdUI('busy', 'Đang kiểm tra…');
  try {
    if (isElectron) {
      const r = await window.mah.checkUpdate();        // main process trả về {state, version, message}
      handleElectronUpd(r, manual);
    } else {
      const rel = await gh(`/repos/${OWNER}/${SELF_REPO}/releases/latest`);
      latestRelease = rel;
      if (rel && semverGt(rel.tag_name, APP_VERSION)) {
        updState.available = rel.tag_name.replace(/^v/, '');
        setUpdUI('avail', 'Có bản mới v' + updState.available);
        toast('Có bản mới v' + updState.available, { action: 'Cập nhật', run: applyUpdate, sticky: true });
      } else { updState.available = null; setUpdUI('ok', 'Đã là bản mới nhất'); if (manual) toast('Bạn đang dùng bản mới nhất (v' + APP_VERSION + ')', { ok: true }); }
    }
  } catch (e) { setUpdUI('', 'Không kiểm tra được: ' + e.message); if (manual) toast('Không kiểm tra được cập nhật: ' + e.message); }
  finally { updState.checking = false; }
}
function handleElectronUpd(r, manual) {
  if (!r) return;
  if (r.state === 'none') { updState.available = null; setUpdUI('ok', 'Đã là bản mới nhất'); if (manual) toast('Bạn đang dùng bản mới nhất (v' + APP_VERSION + ')', { ok: true }); }
  else if (r.state === 'available') { updState.available = r.version; setUpdUI('avail', 'Đang tải bản v' + r.version + '…'); toast('Có bản mới v' + r.version + ', đang tải về…', { ok: true }); }
  else if (r.state === 'downloaded') { updState.available = r.version; updState.downloaded = true; setUpdUI('avail', 'Bản v' + r.version + ' đã tải xong'); toast('Bản v' + r.version + ' đã sẵn sàng', { action: 'Cài & mở lại', run: applyUpdate, sticky: true }); }
  else if (r.state === 'error') { setUpdUI('', 'Không kiểm tra được: ' + (r.message || '')); if (manual) toast('Không kiểm tra được cập nhật: ' + (r.message || '')); }
}
async function applyUpdate() {
  if (isElectron) { if (updState.downloaded) window.mah.installUpdate(); else toast('Đang tải bản mới, chờ một chút…'); return; }
  // Web: nhờ service worker lấy bản mới rồi tải lại trang
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { await reg.update(); reg.waiting?.postMessage('skipWaiting'); } } catch {}
  setTimeout(() => location.reload(), 300);
}
if (isElectron) window.mah.onUpdate?.(r => handleElectronUpd(r, false));

/* ---------- toast ---------- */
let toastEl = null, toastTimer = 0, hideToast = () => {};
function toast(msg, { action, run, undo, sticky, ok } = {}) {
  if (toastEl) { toastEl.remove(); clearTimeout(toastTimer); }
  const t = document.createElement('div'); t.className = 'toast' + (ok ? ' ok' : ''); t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (undo) { action = 'Hoàn tác'; run = undo; }
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn pri'; b.textContent = action; b.onclick = () => { hide(); run(); }; t.appendChild(b); }
  document.body.appendChild(t); toastEl = t;
  const hide = () => { if (toastEl !== t) return; t.classList.add('out'); setTimeout(() => { t.remove(); if (toastEl === t) toastEl = null; }, 250); };
  hideToast = hide;
  if (!sticky) toastTimer = setTimeout(hide, action ? 6000 : 3200);
}

/* ---------- kéo thả sắp xếp (pointer events + FLIP) ---------- */
function flip(container, mutate) {
  const first = new Map([...container.children].map(el => [el, el.getBoundingClientRect()]));
  mutate();
  if (reduced) return;
  for (const el of container.children) {
    if (el.classList.contains('dragging')) continue;
    const a = first.get(el); if (!a) continue;
    const b = el.getBoundingClientRect(), dy = a.top - b.top; if (!dy) continue;
    el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => { el.style.transition = 'transform var(--t-med) var(--ease-out)'; el.style.transform = ''; });
  }
}
let drag = null;
const main = $('#main');
main.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const row = e.target.closest('.row'); if (!row || S.sel === 'hidden') return;
  const list = row.parentElement; if (!list.classList.contains('list')) return;
  const touch = e.pointerType !== 'mouse';
  drag = { row, list, x0: e.clientX, y0: e.clientY, active: false, holdOk: !touch, id: e.pointerId, timer: 0, longPressed: false };
  if (touch) drag.timer = setTimeout(() => { if (!drag) return; drag.holdOk = true; navigator.vibrate?.(15);
    // giữ lâu không kéo → mở menu
    drag.menuTimer = setTimeout(() => { if (drag && !drag.active) { drag.longPressed = true; repoMenu(row.dataset.repo, e.clientX, e.clientY); } }, 250); }, 320);
});
main.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.active) {
    if (!drag.holdOk) { if (Math.hypot(dx, dy) > 6) { clearTimeout(drag.timer); drag = null; } return; }   // cuộn trang trên cảm ứng
    if (Math.hypot(dx, dy) < 4) return;
    clearTimeout(drag.menuTimer); closeMenu();
    drag.active = true; drag.row.classList.add('dragging'); drag.row.setPointerCapture?.(e.pointerId); drag.h = drag.row.offsetHeight;
    document.body.style.cursor = 'grabbing';
  }
  e.preventDefault();
  drag.row.style.transform = `translateY(${dy}px) scale(1.03)`;
  // tìm vị trí mới trong list
  const rows = [...drag.list.children].filter(r => r !== drag.row);
  const cy = e.clientY;
  let before = null;
  for (const r of rows) { const b = r.getBoundingClientRect(); if (cy < b.top + b.height / 2) { before = r; break; } }
  const cur = drag.row.nextElementSibling;
  if (before !== cur) {
    const top0 = drag.row.getBoundingClientRect().top;
    flip(drag.list, () => drag.list.insertBefore(drag.row, before));
    const top1 = drag.row.getBoundingClientRect().top; drag.y0 += top1 - top0;      // giữ ô đang kéo bám theo con trỏ
    drag.row.style.transform = `translateY(${e.clientY - drag.y0}px) scale(1.03)`;
  }
  // tự cuộn khi kéo sát mép
  const mb = main.getBoundingClientRect();
  if (cy < mb.top + 40) main.scrollTop -= 8; else if (cy > mb.bottom - 40) main.scrollTop += 8;
});
function endDrag(e, cancel) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (e === null) { try { drag.row.releasePointerCapture?.(drag.id); } catch {} }
  clearTimeout(drag.timer); clearTimeout(drag.menuTimer);
  const d = drag; drag = null; document.body.style.cursor = '';
  if (!d.active) return;
  d.row.classList.remove('dragging');
  d.row.style.transition = reduced ? 'none' : 'transform var(--t-med) var(--ease-out)'; d.row.style.transform = '';
  setTimeout(() => { d.row.style.transition = ''; }, 250);
  if (cancel) { render(); return; }
  S.order[d.list.dataset.key] = [...d.list.children].map(r => r.dataset.repo); save('order');
}
main.addEventListener('pointerup', e => endDrag(e, false));
main.addEventListener('pointercancel', e => endDrag(e, true));
main.addEventListener('contextmenu', e => { const row = e.target.closest('.row'); if (!row) return; e.preventDefault(); if (drag?.longPressed) { drag = null; return; } repoMenu(row.dataset.repo, e.clientX, e.clientY); });
main.addEventListener('keydown', e => { const row = e.target.closest('.row'); if (!row) return; if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu') { e.preventDefault(); const b = row.getBoundingClientRect(); repoMenu(row.dataset.repo, b.left + 40, b.top + 24); } });

/* ---------- sự kiện nhóm ---------- */
function onGroupClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'addGroup' || b.id === 'addGroupM') return addGroup();
  if (b.dataset.g) { S.sel = b.dataset.g; save('sel'); render(); }
}
$('#side').addEventListener('click', onGroupClick);
$('#chips').addEventListener('click', onGroupClick);
$('#side').addEventListener('contextmenu', e => { const b = e.target.closest('button[data-g]'); if (!b || !S.groups.some(g => g.id === b.dataset.g)) return; e.preventDefault(); groupMenu(b.dataset.g, e.clientX, e.clientY); });
let chipHold = 0;
$('#chips').addEventListener('pointerdown', e => { const b = e.target.closest('button[data-g]'); if (!b || !S.groups.some(g => g.id === b.dataset.g)) return;
  chipHold = setTimeout(() => { navigator.vibrate?.(15); groupMenu(b.dataset.g, e.clientX, e.clientY); }, 450); });
['pointerup', 'pointercancel', 'pointermove'].forEach(ev => $('#chips').addEventListener(ev, e => { if (ev === 'pointermove' && Math.abs(e.movementX) < 3) return; clearTimeout(chipHold); }));
$('#chips').addEventListener('contextmenu', e => { const b = e.target.closest('button[data-g]'); if (b && S.groups.some(g => g.id === b.dataset.g)) { e.preventDefault(); groupMenu(b.dataset.g, e.clientX, e.clientY); } });

/* ---------- nút trên cùng ---------- */
$('#btnReload').onclick = () => reload(false); $('#mbtnReload').onclick = () => reload(false);
$('#btnSettings').onclick = openSettings; $('#mbtnSettings').onclick = openSettings;
$('#btnUpd').onclick = () => checkUpdate(true); $('#mbtnUpd').onclick = () => checkUpdate(true);
$('#dot').onclick = () => toast($('#dot').title, { ok: $('#dot').classList.contains('ok') }); $('#mdot').onclick = () => toast($('#mdot').title, { ok: $('#mdot').classList.contains('ok') });
const onQ = v => { S.q = v.trim(); render(); };
$('#q').addEventListener('input', e => onQ(e.target.value));
$('#mq').addEventListener('input', e => onQ(e.target.value));
const closeMSearch = () => { $('#mstrip').classList.remove('searching'); $('#mq').value = ''; onQ(''); };
$('#mbtnSearch').onclick = () => { $('#mstrip').classList.add('searching'); $('#mq').focus(); };
$('#mqClose').onclick = closeMSearch;
$('#mq').addEventListener('keydown', e => { if (e.key === 'Escape') closeMSearch(); });
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); const i = innerWidth > 900 ? $('#q') : ($('#mbtnSearch').click(), $('#mq')); i.focus(); i.select(); }
  if (e.key === 'F5') { e.preventDefault(); reload(false); }
  if (e.key === 'Escape' && document.activeElement === $('#q')) { $('#q').value = ''; onQ(''); $('#q').blur(); }
});

/* ---------- khởi động ---------- */
render();
if (S.cache) setDot('ok', 'Dữ liệu tạm · tải ' + ago(new Date(S.cache.ts).toISOString()));
if (!S.cache || Date.now() - S.cache.ts > CACHE_TTL) reload(false);
setTimeout(() => checkUpdate(false), 2500);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!reduced) $$('.side,.main').forEach((el, i) => { el.classList.add('fx-rise'); el.style.animationDelay = i * 60 + 'ms'; });
})();
