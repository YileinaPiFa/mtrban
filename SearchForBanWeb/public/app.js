const DEFAULT_API = 'http://110.42.38.161:5032';
const REMOTE_API = localStorage.getItem('sfw_base_url') || DEFAULT_API;

let auth = { token: localStorage.getItem('sfw_token') || '', role: localStorage.getItem('sfw_role') || '', username: localStorage.getItem('sfw_username') || '' };
let currentPage = 'search';
let menuOpen = false;


function req(path, opts = {}) {
  const url = '/proxy' + path;
  const headers = { ...opts.headers };
  headers['X-Target-Host'] = REMOTE_API;
  if (opts.body instanceof FormData) {
    // multipart 不设 Content-Type，让浏览器自动 boundary
  } else {
    headers['Content-Type'] = 'application/json';
  }
  if (auth.token) headers.Authorization = auth.token;
  return fetch(url, { ...opts, headers }).then(r => {
    if (r.status === 401) { logout(); return Promise.reject('未登录'); }
    if (!r.ok) return r.json().then(j => Promise.reject(j.error || '请求失败'), () => Promise.reject('请求失败'));
    if (r.status === 204) return null;
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
  });
}

function get(path) { return req(path, { method: 'GET' }); }
function post(path, body) { return req(path, { method: 'POST', body: JSON.stringify(body) }); }
function del(path) { return req(path, { method: 'DELETE' }); }

function logout() {
  auth = { token: '', role: '', username: '' };
  localStorage.removeItem('sfw_token'); localStorage.removeItem('sfw_role'); localStorage.removeItem('sfw_username');
  renderNav(); go('login');
}

function saveAuth(data) {
  auth.token = data.token; auth.role = data.role; auth.username = data.username;
  localStorage.setItem('sfw_token', data.token);
  localStorage.setItem('sfw_role', data.role);
  localStorage.setItem('sfw_username', data.username);
}

// ===== 导航 =====
const navItems = [
  { id: 'search', label: '黑名单查询', guest: true },
  { id: 'login', label: '登录', unauth: true },
  { id: 'report', label: '举报', login: true },
  { id: 'reports', label: '查看举报', login: true },
  { id: 'addban', label: '添加黑名单', roles: ['authorized','admin'] },
  { id: 'subqq', label: '添加黑名单小号', roles: ['authorized','admin'] },
  { id: 'records', label: '查看封禁记录', roles: ['authorized','admin'] },
  { id: 'users', label: '用户管理', roles: ['admin'] },
  { id: 'dashboard', label: '今日数据', roles: ['admin'] },
  { id: 'setting', label: '设置', guest: true },
  { id: 'about', label: '关于', guest: true },
];

function renderNav() {
  const el = document.getElementById('nav');
  const filtered = navItems.filter(n => {
    if (n.guest) return true;
    if (n.unauth) return !auth.token;
    if (!auth.token) return false;
    if (n.login) return true;
    if (n.roles) return n.roles.includes(auth.role);
    return true;
  });
  el.innerHTML = filtered.map(n => `<a href="#" data-page="${n.id}" class="${currentPage === n.id ? 'active' : ''}">${n.label}</a>`).join('');
  el.querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.page); toggleMenu(false); });
  document.getElementById('userLabel').textContent = auth.token ? (auth.username + ' (' + roleLabel(auth.role) + ')') : '未登录';
}

function roleLabel(r) { return r === 'admin' ? '管理员' : r === 'authorized' ? '授权用户' : '普通用户'; }

function go(page) {
  if (!auth.token && ['report','reports','addban','subqq','records','users','dashboard'].includes(page)) { page = 'login'; }
  if (auth.token && page === 'login') { page = 'search'; }
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  renderNav();
  if (page === 'search') document.getElementById('searchInput').focus();
  if (page === 'records') loadRecords(1);
  if (page === 'reports') loadReports(1);
  if (page === 'users') loadUsers(1);
  if (page === 'dashboard') loadDashboard();
  if (page === 'setting') initSetting();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMenu(v) {
  menuOpen = v !== undefined ? v : !menuOpen;
  document.getElementById('sidebar').classList.toggle('open', menuOpen);
  document.getElementById('overlay').classList.toggle('show', menuOpen);
}

// ===== 弹窗 =====
function modal(title, html, footHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalFoot').innerHTML = footHtml || '';
  document.getElementById('modalOverlay').classList.remove('hidden');
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modal').classList.add('hidden');
}

// ===== 查询页 =====
async function doSearch() {
  const input = document.getElementById('searchInput');
  const qq = input.value.trim().replace(/\D/g, '');
  if (!qq) return;
  const statusEl = document.getElementById('searchStatus');
  const resultEl = document.getElementById('searchResult');
  statusEl.innerHTML = '<span class="warn">正在查询，请稍后...</span>';
  resultEl.innerHTML = '';
  try {
    const data = await get('/api/blacklist?qq=' + encodeURIComponent(qq));
    if (!data.found) {
      statusEl.innerHTML = '<span class="ok">未查询到黑名单记录</span>';
      return;
    }
    const banned = data.current_status?.banned;
    const permanent = data.current_status?.permanent;
    const hasSerious = data.records.some(r => r.ban_type === '封禁' || r.ban_type === 'serious');
    const hasNormal = data.records.some(r => r.ban_type === '重点观察' || r.ban_type === 'normal');
    let badge = '<span class="badge safe">正常</span>';
    if (banned) badge = permanent ? '<span class="badge ban">永久封禁</span>' : '<span class="badge ban">已封禁</span>';
    else if (hasSerious) badge = '<span class="badge ban">有封禁记录</span>';
    else if (hasNormal) badge = '<span class="badge warn">重点观察</span>';
    let html = '<div class="result-card">' + badge;
    html += '<div class="result-meta">';
    html += '<div><span class="label">编号：</span>' + qq + '</div>';
    const nick = data.qq_list.find(q => q.qq === qq)?.nickname || '';
    if (nick) html += '<div><span class="label">昵称：</span>' + nick + '</div>';
    html += '<div><span class="label">记录数量：</span>' + data.records.length + '</div>';
    data.records.forEach(r => {
      html += '<div class="record-item">';
      if (r.created_by) html += '<div><span class="label">操作人：</span>' + r.created_by + '</div>';
      html += '<div><span class="label">封禁原因：</span>' + r.ban_reason + '</div>';
      html += '<div><span class="label">封禁种类：</span>' + r.ban_type + '</div>';
      html += '<div><span class="label">封禁时间：</span>' + r.ban_time + '</div>';
      if (r.ban_duration === 0) html += '<div><span class="label">封禁时长：</span>永久</div>';
      else html += '<div><span class="label">封禁时长：</span>' + r.ban_duration + ' 天</div>';
      html += '</div>';
    });
    const others = data.qq_list.filter(q => q.qq !== qq);
    if (others.length) {
      html += '<div style="margin-top:10px"><span class="label">关联编号：</span></div>';
      others.forEach(q => html += '<span class="qq-tag">' + q.qq + (q.nickname ? ' (' + q.nickname + ')' : '') + '</span>');
    }
    if (data.current_status) {
      const st = data.current_status;
      html += '<div style="margin-top:10px"><span class="label">当前状态：</span>';
      if (st.banned) {
        html += st.permanent ? '永久封禁' : '封禁中 (解封时间: ' + st.expire_time + ')';
      } else {
        html += '未封禁';
      }
      html += '</div>';
    }
    html += '</div></div>';
    resultEl.innerHTML = html;
    statusEl.innerHTML = '';
  } catch (e) {
    statusEl.innerHTML = '<span class="err">数据源出错，请检查网络或稍后再试</span>';
  }
}

// ===== 登录 / 注册 =====
async function doLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  if (!user || !pass) return;
  try {
    const data = await post('/api/login', { username: user, password: pass });
    saveAuth(data);
    if (document.getElementById('loginRemember').checked) {
      localStorage.setItem('sfw_remember', '1');
      localStorage.setItem('sfw_remember_u', user);
      localStorage.setItem('sfw_remember_p', pass);
    } else {
      localStorage.removeItem('sfw_remember');
    }
    renderNav(); go('search');
  } catch (e) {
    document.getElementById('loginError').textContent = e;
  }
}

async function doRegister() {
  const user = document.getElementById('regUser').value.trim();
  const pass = document.getElementById('regPass').value;
  if (!user || !pass) return;
  try {
    await post('/api/register', { username: user, password: pass });
    go('login');
  } catch (e) {
    document.getElementById('regError').textContent = e;
  }
}

// ===== 添加黑名单 =====
let addBanType = 'serious';
function initAddBan() {
  document.querySelectorAll('#page-addban .type-btn').forEach(b => {
    b.onclick = () => { addBanType = b.dataset.val; document.querySelectorAll('#page-addban .type-btn').forEach(x => x.classList.toggle('active', x === b)); };
  });
}

async function submitBan() {
  const qq = document.getElementById('addQQ').value.trim();
  const nickname = document.getElementById('addNick').value.trim();
  const reason = document.getElementById('addReason').value.trim();
  const duration = parseInt(document.getElementById('addDuration').value) || 0;
  const time = document.getElementById('addTime').value;
  if (!qq || !reason || !time) { alert('请填写必填项'); return; }
  try {
    await post('/api/blacklist/add', { qq, nickname, ban_reason: reason, ban_time: time, ban_type: addBanType, ban_duration: duration });
    modal('提示', '封禁成功', '<button onclick="closeModal()">确定</button>');
    clearAddBan();
  } catch (e) { alert(e); }
}

function clearAddBan() {
  document.getElementById('addQQ').value = '';
  document.getElementById('addNick').value = '';
  document.getElementById('addReason').value = '';
  document.getElementById('addDuration').value = '';
  document.getElementById('addTime').value = '';
  addBanType = 'serious';
  document.querySelectorAll('#page-addban .type-btn').forEach(b => b.classList.toggle('active', b.dataset.val === 'serious'));
}

// ===== 添加小号 =====
async function submitSubQQ() {
  const oldQQ = document.getElementById('subOldQQ').value.trim();
  const newQQ = document.getElementById('subNewQQ').value.trim();
  const nick = document.getElementById('subNick').value.trim();
  if (!oldQQ || !newQQ) return;
  try {
    await post('/api/blacklist/add_qq', { old_qq: oldQQ, new_qq: newQQ, qq_nickname: nick });
    modal('提示', '添加成功', '<button onclick="closeModal()">确定</button>');
    document.getElementById('subOldQQ').value = '';
    document.getElementById('subNewQQ').value = '';
    document.getElementById('subNick').value = '';
  } catch (e) { alert(e); }
}

// ===== 封禁记录 =====
let recordsPage = 1, recordsTotal = 1, recordsSearch = '';
async function loadRecords(page) {
  recordsPage = page;
  const el = document.getElementById('recordList');
  el.innerHTML = '<p style="text-align:center;color:var(--text2)">加载中...</p>';
  try {
    const url = '/api/blacklist/all?page=' + page + '&page_size=4' + (recordsSearch ? '&search_qq=' + encodeURIComponent(recordsSearch) : '');
    const data = await get(url);
    recordsTotal = data.total_pages;
    if (!data.data.length) { el.innerHTML = '<p style="text-align:center;color:var(--text2)">暂无记录</p>'; }
    else {
      el.innerHTML = data.data.map(item => {
        let html = '<div class="card">';
        html += '<div><span class="label">QQ列表：</span>' + item.qq_list.map(q => q.qq_number + (q.qq_nickname ? '(' + q.qq_nickname + ')' : '')).join('、') + '</div>';
        item.ban_records.forEach(r => {
          html += '<div class="record-item">';
          html += '<div><span class="label">类型：</span>' + (r.ban_type === 'serious' ? '封禁' : '观察') + ' &nbsp; <span class="label">原因：</span>' + r.ban_reason + '</div>';
          html += '<div><span class="label">时间：</span>' + r.ban_time + ' &nbsp; <span class="label">时长：</span>' + (r.ban_duration === 0 ? '永久' : r.ban_duration + '天') + '</div>';
          html += '<div class="card-actions">';
          html += '<button onclick="editRecord(' + r.record_id + ',' + item.person_id + ',\'' + escapeStr(r.ban_reason) + '\',\'' + r.ban_type + '\',\'' + r.ban_duration + '\',\'' + r.ban_time + '\')">修改</button>';
          html += '<button onclick="addSubQQ(' + item.person_id + ',\'' + item.qq_list[0]?.qq_number + '\')">添加小号</button>';
          html += '<button class="btn-danger" onclick="deletePerson(\'' + item.qq_list[0]?.qq_number + '\')">删除</button>';
          html += '</div></div>';
        });
        html += '</div>';
        return html;
      }).join('');
    }
    document.getElementById('recordPager').innerHTML = pagerHtml(recordsPage, recordsTotal, loadRecords);
  } catch (e) { el.innerHTML = '<p style="text-align:center;color:var(--danger)">加载失败</p>'; }
}

function escapeStr(s) { return (s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/\n/g,'\\n'); }

async function deletePerson(qq) {
  if (!confirm('确定删除该人员及其所有记录？')) return;
  try { await post('/api/blacklist/delete_person', { qq }); loadRecords(recordsPage); } catch (e) { alert(e); }
}

function editRecord(recordId, personId, reason, type, duration, time) {
  modal('修改记录',
    '<div class="form-wrap">' +
    '<textarea id="editReason" rows="3">' + reason.replace(/\\n/g,'\n') + '</textarea>' +
    '<div class="type-row"><span>类型:</span><button class="type-btn ' + (type==='serious'?'active':'') + '" onclick="document.querySelectorAll(\'#modal .type-btn\').forEach(x=>x.classList.remove(\'active\'));this.classList.add(\'active\');window.editType=\'serious\'">封禁</button><button class="type-btn ' + (type==='normal'?'active':'') + '" onclick="document.querySelectorAll(\'#modal .type-btn\').forEach(x=>x.classList.remove(\'active\'));this.classList.add(\'active\');window.editType=\'normal\'">观察</button></div>' +
    '<input type="text" id="editDuration" value="' + duration + '">' +
    '<input type="text" id="editTime" value="' + time + '">' +
    '</div>',
    '<button class="btn-secondary" onclick="closeModal()">取消</button><button onclick="doEditRecord(' + recordId + ')">保存</button>'
  );
  window.editType = type;
}

async function doEditRecord(id) {
  try {
    await post('/api/blacklist/update_record', {
      record_id: id,
      ban_reason: document.getElementById('editReason').value,
      ban_type: window.editType,
      ban_duration: document.getElementById('editDuration').value,
      ban_time: document.getElementById('editTime').value
    });
    closeModal(); loadRecords(recordsPage);
  } catch (e) { alert(e); }
}

function addSubQQ(personId, qq) {
  document.getElementById('subOldQQ').value = qq || '';
  go('subqq');
}

// ===== 举报 =====
let repFiles = [];
function initReport() {
  document.getElementById('repPickImg').onclick = () => document.getElementById('repImages').click();
  document.getElementById('repImages').onchange = e => {
    repFiles = Array.from(e.target.files);
    const preview = document.getElementById('repPreview');
    preview.innerHTML = repFiles.map((f, i) => '<img src="' + URL.createObjectURL(f) + '" class="img-thumb" onclick="removeRepImg(' + i + ')">').join('');
  };
}
function removeRepImg(i) { repFiles.splice(i, 1); refreshRepPreview(); }
function refreshRepPreview() {
  document.getElementById('repPreview').innerHTML = repFiles.map((f, i) => '<img src="' + URL.createObjectURL(f) + '" class="img-thumb" onclick="removeRepImg(' + i + ')">').join('');
}

async function submitReport() {
  const qq = document.getElementById('repQQ').value.trim();
  const name = document.getElementById('repName').value.trim();
  const email = document.getElementById('repEmail').value.trim();
  const reason = document.getElementById('repReason').value.trim();
  if (!qq || !reason || !email || !repFiles.length) { alert('请填写完整信息并上传图片'); return; }
  const fd = new FormData();
  fd.append('reported_qq', qq); fd.append('reported_name', name); fd.append('report_reason', reason); fd.append('reporter_email', email);
  repFiles.forEach(f => fd.append('images', f));
  const bar = document.getElementById('repProgressBar');
  const wrap = document.getElementById('repProgressWrap');
  wrap.style.display = 'block'; bar.style.width = '0';
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/proxy/api/report');
    if (auth.token) xhr.setRequestHeader('Authorization', auth.token);
    xhr.setRequestHeader('X-Target-Host', REMOTE_API);
    xhr.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
    xhr.onload = () => {
      wrap.style.display = 'none';
      if (xhr.status >= 200 && xhr.status < 300) {
        alert('举报成功');
        document.getElementById('repQQ').value = ''; document.getElementById('repName').value = '';
        document.getElementById('repEmail').value = ''; document.getElementById('repReason').value = '';
        repFiles = []; document.getElementById('repPreview').innerHTML = '';
        document.getElementById('repImages').value = '';
      } else {
        let msg = '举报失败 (' + xhr.status + ')';
        try { const j = JSON.parse(xhr.responseText); if (j.error) msg += ': ' + j.error; } catch {}
        alert(msg);
      }
    };
    xhr.onerror = () => { wrap.style.display = 'none'; alert('网络错误'); };
    xhr.send(fd);
  } catch (e) { wrap.style.display = 'none'; alert(e); }
}

// ===== 查看举报 =====
let reportsPage = 1, reportsTotal = 1, reportsFilter = 'all', reportsSearchQQ = '';
let reportsDataCache = [];

async function loadReports(page) {
  reportsPage = page;
  const el = document.getElementById('reportsList');
  el.innerHTML = '<p style="text-align:center;color:var(--text2)">加载中...</p>';
  try {
    let url = '/api/reports?page=' + page + '&size=5';
    if (reportsFilter !== 'all') url += '&status=' + reportsFilter;
    if (reportsSearchQQ) url += '&reported_qq=' + encodeURIComponent(reportsSearchQQ);
    const data = await get(url);
    reportsDataCache = data.data || [];
    reportsTotal = data.total_pages;
    if (!data.data.length) { el.innerHTML = '<p style="text-align:center;color:var(--text2)">暂无举报</p>'; }
    else {
      el.innerHTML = data.data.map(r => {
        const processed = r.status === 'processed';
        let html = '<div class="card">';
        html += '<div>被举报人: ' + r.reported_name + ' (QQ: ' + r.reported_qq + ')</div>';
        html += '<div>举报人: ' + r.username + ' (' + r.reporter_email + ')</div>';
        html += '<div>理由: ' + r.report_reason + '</div>';
        html += '<div style="margin-top:4px;color:' + (processed ? 'var(--primary)' : 'var(--danger)') + '">状态: ' + (processed ? '已处理' : '未处理') + '</div>';
        html += '<div class="card-actions">';
        html += '<button onclick="copyText(\'' + r.reported_qq + '\')">复制QQ号</button>';
        if (auth.role === 'admin' || auth.role === 'authorized') {
          html += '<button onclick="quickBan(\'' + r.reported_qq + '\',\'' + escapeStr(r.report_reason) + '\')">快速处理</button>';
        }
        html += '<button onclick="toggleReportImages(' + r.id + ',this)">查看图片</button>';
        html += '</div>';
        if (auth.role === 'admin' || auth.role === 'authorized') {
          html += '<div class="card-actions">';
          html += '<button ' + (processed ? 'disabled' : '') + ' onclick="markReport(' + r.id + ')">标记为已处理</button>';
          if (auth.role === 'admin') html += '<button class="btn-danger" ' + (processed ? 'disabled' : '') + ' onclick="deleteReport(' + r.id + ')">删除</button>';
          html += '</div>';
        }
        html += '<div id="rep-imgs-' + r.id + '" style="display:none;margin-top:8px;"></div>';
        html += '</div>';
        return html;
      }).join('');
    }
    document.getElementById('reportsPager').innerHTML = pagerHtml(reportsPage, reportsTotal, loadReports);
  } catch (e) { el.innerHTML = '<p style="text-align:center;color:var(--danger)">加载失败</p>'; }
}

function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => alert('已复制')).catch(() => fallbackCopy(t));
  } else { fallbackCopy(t); }
}
function fallbackCopy(t) {
  var ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); alert('已复制'); } catch (e) {}
  document.body.removeChild(ta);
}
function doPaste(callback) {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function(text) {
      if (text) { callback(text); }
      else { manualPaste(callback); }
    }).catch(function() { manualPaste(callback); });
  } else { manualPaste(callback); }
}
function manualPaste(callback) {
  modal('粘贴', '<textarea id="manualPasteArea" rows="5" placeholder="在此粘贴内容"></textarea>',
    '<button class="btn-secondary" onclick="closeModal()">取消</button><button onclick="doManualPaste()">确定</button>');
  setTimeout(function() { var a = document.getElementById('manualPasteArea'); if (a) a.focus(); }, 100);
  window._pasteCallback = callback;
}
function doManualPaste() {
  var v = document.getElementById('manualPasteArea').value;
  closeModal();
  if (window._pasteCallback) { window._pasteCallback(v); window._pasteCallback = null; }
}
function quickBan(qq, reason) { document.getElementById('addQQ').value = qq; document.getElementById('addReason').value = reason.replace(/\\n/g,'\n'); go('addban'); }
async function markReport(id) { try { await post('/api/report/status', { report_id: id, status: 'processed' }); loadReports(reportsPage); } catch (e) { alert(e); } }
async function deleteReport(id) { if (!confirm('确定删除？')) return; try { await del('/api/report/delete/' + id); loadReports(reportsPage); } catch (e) { alert(e); } }

async function toggleReportImages(id, btn) {
  const el = document.getElementById('rep-imgs-' + id);
  if (el.style.display === 'none') {
    el.style.display = 'block'; btn.textContent = '收起图片';
    if (!el.innerHTML) {
      const r = reportsDataCache.find(x => x.id === id);
      if (r && r.images && r.images.length) {
        el.innerHTML = r.images.map(img => '<img src="/proxy/api/report/image/' + img + '?_t=' + REMOTE_API + '" class="img-thumb" onclick="viewImage(this.src)">').join('');
      } else { el.innerHTML = '<p style="color:var(--text2);font-size:13px;">无图片</p>'; }
    }
  } else { el.style.display = 'none'; btn.textContent = '查看图片'; }
}

function viewImage(src) {
  const div = document.createElement('div'); div.className = 'img-viewer';
  div.innerHTML = '<button class="close-btn icon-btn" onclick="this.parentElement.remove()">&#10005;</button><img src="' + src + '">';
  div.onclick = e => { if (e.target === div) div.remove(); };
  document.body.appendChild(div);
}

// ===== 用户管理 =====
let usersPage = 1, usersTotal = 1, usersSearch = '', usersRoleFilter = 'all';
async function loadUsers(page) {
  usersPage = page;
  const el = document.getElementById('usersList');
  el.innerHTML = '<p style="text-align:center;color:var(--text2)">加载中...</p>';
  try {
    let url = '/api/users?page=' + page + '&page_size=4';
    if (usersSearch) url += '&search=' + encodeURIComponent(usersSearch);
    if (usersRoleFilter !== 'all') url += '&role=' + usersRoleFilter;
    const data = await get(url);
    usersTotal = data.total_pages;
    if (!data.data.length) { el.innerHTML = '<p style="text-align:center;color:var(--text2)">无用户</p>'; }
    else {
      el.innerHTML = data.data.map(u => {
        let html = '<div class="card"><div class="card-head"><span class="card-title">' + u.username + '</span><span class="card-role role-' + u.role + '">' + roleLabel(u.role) + '</span></div>';
        html += '<div style="font-size:13px;color:var(--text2)">创建时间：' + u.created_at + '</div>';
        html += '<div class="card-actions">';
        html += '<button onclick="changeRole(\'' + u.username + '\',\'' + u.role + '\')">修改权限</button>';
        html += '<button onclick="resetPass(\'' + u.username + '\')">修改密码</button>';
        if (u.role !== 'user') html += '<button class="btn-secondary" onclick="viewUserRecords(\'' + u.username + '\')">封禁记录</button>';
        html += '</div></div>';
        return html;
      }).join('');
    }
    document.getElementById('usersPager').innerHTML = pagerHtml(usersPage, usersTotal, loadUsers);
  } catch (e) { el.innerHTML = '<p style="text-align:center;color:var(--danger)">加载失败</p>'; }
}

function changeRole(username, current) {
  const roles = [['user','普通用户'],['authorized','授权用户'],['admin','管理员']];
  let html = '<div class="form-wrap">' + roles.map(r => '<label class="check-row"><input type="radio" name="newRole" value="' + r[0] + '" ' + (r[0]===current?'checked':'') + '> ' + r[1] + '</label>').join('') + '</div>';
  modal('修改权限', html, '<button class="btn-secondary" onclick="closeModal()">取消</button><button onclick="doChangeRole(\'' + username + '\')">确定</button>');
}
async function doChangeRole(username) {
  const el = document.querySelector('input[name="newRole"]:checked');
  if (!el) return;
  try { await post('/api/admin/set_role', { username, role: el.value }); closeModal(); loadUsers(usersPage); } catch (e) { alert(e); }
}
function resetPass(username) {
  modal('重置密码', '<input type="text" id="resetPassInput" placeholder="新密码">', '<button class="btn-secondary" onclick="closeModal()">取消</button><button onclick="doResetPass(\'' + username + '\')">确定</button>');
}
async function doResetPass(username) {
  const pass = document.getElementById('resetPassInput').value;
  if (!pass) return;
  try { await post('/api/admin/reset_password', { username, new_password: pass }); closeModal(); alert('密码已重置'); } catch (e) { alert(e); }
}

function viewUserRecords(username) {
  recordsSearch = '';
  document.getElementById('recordSearchQQ').value = '';
  go('records');
}

// ===== 今日数据 =====
async function loadDashboard() {
  try {
    const data = await get('/api/admin/dashboard');
    document.getElementById('dashTodayTokens').textContent = data.today_tokens;
    document.getElementById('dashTotalTokens').textContent = data.total_tokens;
    document.getElementById('dashTodayUsers').textContent = data.today_users;
    document.getElementById('dashTotalUsers').textContent = data.total_users;
  } catch (e) {
    document.getElementById('dashTodayTokens').textContent = '-';
    document.getElementById('dashTotalTokens').textContent = '-';
    document.getElementById('dashTodayUsers').textContent = '-';
    document.getElementById('dashTotalUsers').textContent = '-';
  }
}

// ===== 设置 =====
function initSetting() {
  document.getElementById('settingUrl').value = REMOTE_API;
  document.getElementById('settingAuth').style.display = auth.token ? 'block' : 'none';
}
async function changePassword() {
  const oldPass = document.getElementById('settingOldPass').value;
  const newPass = document.getElementById('settingNewPass').value;
  if (!oldPass || !newPass) return;
  try { await post('/api/user/change_password', { old_password: oldPass, new_password: newPass }); document.getElementById('settingMsg').textContent = '密码修改成功'; }
  catch (e) { document.getElementById('settingMsg').textContent = e; }
}

// ===== 时间选择器 =====
function initPicker() {
  const year = document.getElementById('dtYear');
  const month = document.getElementById('dtMonth');
  const day = document.getElementById('dtDay');
  const hour = document.getElementById('dtHour');
  const min = document.getElementById('dtMin');
  const now = new Date();
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 2; y++) year.innerHTML += '<option value="' + y + '">' + y + '</option>';
  for (let m = 1; m <= 12; m++) month.innerHTML += '<option value="' + m + '">' + m + '</option>';
  for (let d = 1; d <= 31; d++) day.innerHTML += '<option value="' + d + '">' + d + '</option>';
  for (let h = 0; h < 24; h++) hour.innerHTML += '<option value="' + h + '">' + h + '</option>';
  for (let n = 0; n < 60; n++) min.innerHTML += '<option value="' + n + '">' + String(n).padStart(2,'0') + '</option>';
  year.value = now.getFullYear(); month.value = now.getMonth() + 1; day.value = now.getDate();
  hour.value = now.getHours(); min.value = now.getMinutes();
}

function showPicker(onOk) {
  const picker = document.getElementById('dtPicker');
  picker.classList.remove('hidden');
  document.getElementById('dtOk').onclick = () => {
    const y = document.getElementById('dtYear').value;
    const m = String(document.getElementById('dtMonth').value).padStart(2,'0');
    const d = String(document.getElementById('dtDay').value).padStart(2,'0');
    const h = String(document.getElementById('dtHour').value).padStart(2,'0');
    const n = String(document.getElementById('dtMin').value).padStart(2,'0');
    onOk(y + '-' + m + '-' + d + ' ' + h + ':' + n);
    picker.classList.add('hidden');
  };
  document.getElementById('dtCancel').onclick = () => picker.classList.add('hidden');
}

// ===== 分页 =====
function pagerHtml(page, total, cb) {
  return '<button ' + (page <= 1 ? 'disabled' : '') + ' onclick="' + cb.name + '(' + (page - 1) + ')">上一页</button>' +
    '<span class="pager-info">' + page + ' / ' + total + '</span>' +
    '<button ' + (page >= total ? 'disabled' : '') + ' onclick="' + cb.name + '(' + (page + 1) + ')">下一页</button>';
}

// ===== 封禁条例 =====
const ruleTree = [
  { t: '一、涉及模组/追加包违规', children: [
    { t: '第一条 定义与解释', children: [
      { t: '1.1 追加包：指基于《我的世界》MTR模组开发的扩展内容包，包括但不限于付费追加包和免费追加包。' },
      { t: '1.2 付费追加包：指需要支付费用方可获取使用授权的追加包。' },
      { t: '1.3 免费追加包：指无需支付费用即可获取的追加包，但可能包含功能限制。' },
      { t: '1.4 包主/制作组：指追加包的知识产权所有者或合法授权开发者。' },
      { t: '1.5 二创：指在原有追加包基础上进行的二次创作，包括但不限于修改、改编、翻译、汇编等。' },
      { t: '1.6 服务器授权：指将追加包用于多人游戏服务器的特别许可。' }
    ]},
    { t: '第二条 协议适用范围', children: [
      { t: '2.1 本协议适用于所有使用、购买、二创或以其他方式使用本协议项下追加包的自然人、法人或非法人组织。' },
      { t: '2.2 本协议构成您与我们及相应包主/制作组之间关于追加包使用的完整协议。' }
    ]},
    { t: '第三条 知识产权声明', children: [
      { t: '3.1 权利归属：所有追加包的著作权、商标权、专利权及其他知识产权，均归 respective 包主/制作组所有。' },
      { t: '3.2 授权性质：无论付费或免费，我们向您提供的均为有限、非独占、不可转让、可撤销的使用许可。' },
      { t: '3.3 开源声明：部分追加包可能包含第三方开源组件，其使用应遵守相应开源许可证的规定。' }
    ]},
    { t: '第四条 使用规范', children: [
      { t: '4.1 合法使用义务：您承诺在使用追加包时遵守中华人民共和国法律法规。' },
      { t: '4.2 禁止行为：盗包、传包、改包、未经授权的服务器使用、未经授权的二创、侮辱诽谤。' },
      { t: '4.3 购买规范：您应仔细阅读购买页面说明，提供真实信息，通过官方渠道支付，并妥善保管凭证。' },
      { t: '4.4 社群规范：进入官方社群后，应遵守群规，服从管理员管理。' }
    ]},
    { t: '第五条 授权体系', children: [
      { t: '5.1 个人使用授权：购买付费追加包后，获得单一设备/账户使用授权，不可转让、共享。' },
      { t: '5.2 二创授权：需书面申请、支付费用并签署协议，在作品中标注原作者。' },
      { t: '5.3 服务器授权：需书面申请，费用不得高于 10 元人民币，并标注来源。' },
      { t: '5.4 授权终止：违反协议可终止授权并销毁副本。' }
    ]},
    { t: '第六条 违约责任', children: [
      { t: '6.1 您从事本协议第 4.2 条所列禁止行为的，构成根本违约。' },
      { t: '6.2 我们有权采取警告、限制功能、列入黑名单、终止授权、要求赔偿、法律追责等措施。' },
      { t: '6.3 存在盗包、传包、改包且拒不配合调查或累计两次违规的，可永久限制。' }
    ]},
    { t: '第七条 免责条款' },
    { t: '第八条 协议的变更与终止' },
    { t: '第九条 争议解决' },
    { t: '第十条 其他条款' }
  ]},
  { t: '二、涉及群聊违规', children: [
    { t: '附件一：MTR 群聊规范条例' },
    { t: '一、条例适用范围', children: [
      { t: '1.1 本条例适用于 MTR 模组的相关群聊。' },
      { t: '1.2 关于追加包讨论群的划定。' },
      { t: '1.3 关于服务器讨论群的划定。' }
    ]},
    { t: '二、群员规范', children: [
      { t: '2.1 遵守中华人民共和国相关法律法规。' },
      { t: '2.2 服从群主/管理员管理。' },
      { t: '2.3 遵守《我的世界 MTR 模组追加包使用条例》。' },
      { t: '2.4 服从 MTR 追加包反盗包督察组管理。' }
    ]},
    { t: '三、群主/管理员规范', children: [
      { t: '3.1 群主/管理员应遵守所有群员规范。' },
      { t: '3.2 应管理群员违规行为。' },
      { t: '3.3 发现违规应举报至督察组。' }
    ]},
    { t: '四、禁止行为', children: [
      { t: '4.1 群成员禁止行为。' },
      { t: '4.2 群主/管理员禁止行为。' }
    ]},
    { t: '五、处罚', children: [
      { t: '5.1 违反 4.1.1-4.1.3 或 4.2.1 行为者，可禁言、踢出、加入黑名单。' },
      { t: '5.2 违反 4.1.4 行为者，由督察组依据追加包条例处罚。' },
      { t: '5.3 违反 4.2.2-4.2.3 者，可 1—7 天至永久封禁。' }
    ]},
    { t: '六、其他条例', children: [
      { t: '6.1 进入群聊即视为同意本条例。' },
      { t: '6.2 本条例具有可分割性。' },
      { t: '6.3 最终解释权归 MTR 追加包反盗包督察组所有。' },
      { t: '6.4 本条例自 2026 年 2 月 23 日起生效。' }
    ]}
  ]}
];

function showRulePicker() {
  let stack = [];
  let current = ruleTree;
  function render() {
    let html = current.map((n, i) => '<button class="rule-item" data-i="' + i + '">' + n.t + '</button>').join('');
    if (stack.length) html += '<button class="rule-back" onclick="window.ruleBack()">返回上一级</button>';
    modal('选择封禁条例', html, '<button class="btn-secondary" onclick="closeModal()">关闭</button>');
    document.querySelectorAll('.rule-item').forEach(b => b.onclick = () => {
      const n = current[b.dataset.i];
      if (n.children) { stack.push(current); current = n.children; render(); }
      else {
        const reasonEl = document.getElementById('addReason');
        reasonEl.value = reasonEl.value ? reasonEl.value + '\n' + n.t : n.t;
        closeModal();
      }
    });
  }
  window.ruleBack = () => { if (stack.length) { current = stack.pop(); render(); } };
  render();
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
  initPicker(); initAddBan(); initReport();

  // 菜单
  document.getElementById('menuOpen').onclick = () => toggleMenu(true);
  document.getElementById('menuClose').onclick = () => toggleMenu(false);
  document.getElementById('overlay').onclick = () => toggleMenu(false);
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('modalOverlay').onclick = closeModal;

  // 查询
  document.getElementById('searchBtn').onclick = doSearch;
  document.getElementById('searchInput').onkeydown = e => { if (e.key === 'Enter') doSearch(); };
  document.getElementById('searchPaste').onclick = () => {
    doPaste(t => { document.getElementById('searchInput').value = (t || '').replace(/\D/g, ''); doSearch(); });
  };
  document.getElementById('appealBtn').onclick = () => modal('申诉', '您可以通过邮箱联系我们，我们的申诉邮箱 admin@ylnpf.cn', '<button onclick="closeModal()">关闭</button>');

  // 登录
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('toRegister').onclick = () => go('register');
  const ru = localStorage.getItem('sfw_remember_u');
  const rp = localStorage.getItem('sfw_remember_p');
  if (ru && rp) { document.getElementById('loginUser').value = ru; document.getElementById('loginPass').value = rp; document.getElementById('loginRemember').checked = true; }

  // 注册
  document.getElementById('regBtn').onclick = doRegister;
  document.getElementById('toLogin').onclick = () => go('login');
  document.getElementById('regAgree').onchange = e => document.getElementById('regBtn').disabled = !e.target.checked;
  document.getElementById('showNeed').onclick = e => { e.preventDefault(); modal('追加包使用条例', '本条例适用于所有使用 MTR 模组追加包的用户。详细内容请参阅完整版条例。', '<button onclick="closeModal()">关闭</button>'); };
  document.getElementById('showUser').onclick = e => { e.preventDefault(); modal('隐私政策', '我们尊重并保护用户隐私。', '<button onclick="closeModal()">关闭</button>'); };

  // 粘贴按钮
  document.querySelectorAll('.paste-btn').forEach(b => b.onclick = () => {
    doPaste(t => { const el = document.getElementById(b.dataset.target); if (el) el.value = t; });
  });

  // 添加黑名单
  document.getElementById('addBanSubmit').onclick = submitBan;
  document.getElementById('addBanClear').onclick = clearAddBan;
  document.getElementById('rulePickerBtn').onclick = showRulePicker;
  document.getElementById('pickTimeBtn').onclick = () => showPicker(v => document.getElementById('addTime').value = v);

  // 添加小号
  document.getElementById('subQQSubmit').onclick = submitSubQQ;

  // 提交举报
  document.getElementById('repSubmit').onclick = submitReport;

  // 记录筛选
  document.getElementById('recordSearchBtn').onclick = () => { recordsSearch = document.getElementById('recordSearchQQ').value.trim(); loadRecords(1); };

  // 举报筛选
  document.getElementById('reportsSearchBtn').onclick = () => { reportsSearchQQ = document.getElementById('reportsSearchQQ').value.trim(); loadReports(1); };
  document.querySelectorAll('#reportsTabs .tab-btn').forEach(b => b.onclick = () => {
    reportsFilter = b.dataset.val;
    document.querySelectorAll('#reportsTabs .tab-btn').forEach(x => x.classList.toggle('active', x === b));
    loadReports(1);
  });

  // 用户筛选
  document.getElementById('usersSearchBtn').onclick = () => { usersSearch = document.getElementById('usersSearch').value.trim(); loadUsers(1); };
  document.querySelectorAll('#usersTabs .tab-btn').forEach(b => b.onclick = () => {
    usersRoleFilter = b.dataset.val;
    document.querySelectorAll('#usersTabs .tab-btn').forEach(x => x.classList.toggle('active', x === b));
    loadUsers(1);
  });

  // 设置
  document.getElementById('settingSaveUrl').onclick = () => {
    const url = document.getElementById('settingUrl').value.trim().replace(/\/+$/,'');
    localStorage.setItem('sfw_base_url', url);
    location.reload();
  };
  document.getElementById('settingResetUrl').onclick = () => { localStorage.removeItem('sfw_base_url'); location.reload(); };
  document.getElementById('settingChangePass').onclick = changePassword;
  document.getElementById('settingLogout').onclick = () => { logout(); go('login'); };

  // 关于
  document.getElementById('aboutPrivacy').onclick = () => modal('隐私条例', '我们尊重并保护用户隐私。', '<button onclick="closeModal()">关闭</button>');
  document.getElementById('aboutRules').onclick = () => showRulePicker();
  document.getElementById('aboutMembers').onclick = () => modal('制作成员', 'APP开发 / 后端开发：schmidt<br>网页端/服务器提供：YLNPF<br>文本：TCV', '<button onclick="closeModal()">关闭</button>');

  renderNav();
  if (!auth.token) go('search'); else go('search');
});
