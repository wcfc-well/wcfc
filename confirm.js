// 业务员确认页：一个链接，第一次选名字 + 店面私下发的个人密码，以后自动认出是谁
(function () {
  const S = window.Store, C = window.Calc, Photo = window.Photo;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 每个电话旁边的 📞：点了直接拨打（号码取旁边输入框里的，或按钮自带的）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-call]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const i = b.parentNode.querySelector('[data-op],[data-cp]');
    const n = String(b.dataset.call || (i ? i.value : '')).replace(/[^\d+]/g, '');
    if (n.length < 3) { if (i) { i.focus(); i.placeholder = '还没有电话'; } return; }
    location.href = 'tel:' + n;
  }, true);
  const app = $('#app');
  const demoBar = () => S.mode === 'demo' ? '<div class="notice small">演示模式：数据只在这台设备上。<button id="demo-switch" style="min-height:0;padding:2px 8px;font-size:14px">换一个人试试</button> <a href="index.html">回到店面记账</a></div>' : '';
  const bindDemo = () => { const b = $('#demo-switch'); if (b) b.onclick = () => { S.demoForget(); start(); }; };

  let view = 'stmt';
  const LST = { active: (k) => k === '出租' ? '在租' : '在售', done: (k) => k === '出租' ? '已租' : '已售' };
  const tabs = () => `<div class="ctabs"><button data-view="listings" aria-pressed="${view === 'listings'}">房源</button><button data-view="stmt" aria-pressed="${view === 'stmt'}">我的结算</button></div>`;
  const bindTabs = () => app.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { view = b.dataset.view; start(); });
  const fmtTime = (t) => { if (!t) return ''; const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  // ===== 房源：店面和业务员两边共用（改的时候两个文件一起改） =====
  const CATS = ['小户', '小户带阁楼', '中户', '中户带阁楼', '大户', '大户带阁楼', '特大户', '特大户带阁楼', '商品房', '商铺'];
  const zones = (name, n) => Array.from({ length: n }, (_, i) => `${name}${'一二三四五六七八九'[i]}区`);
  const COMMUNITIES = ['东亭家园', '厦亭家园', ...zones('怡邻花园', 5), '悬珠花园', '阳澄人家', '亭南新村', ...zones('青苑新村', 6), ...zones('畅苑新村', 4), '青灯新村', '亭苑', '金陵花园', '绿地', '融锦苑', '雍合湾', '唯锦苑', '唯亭苑'];
  const layoutText = (x) => x.rooms != null && x.rooms !== '' ? `${x.rooms}室${x.halls || 0}厅` : (x.layout || '');
  const cardSpec = (x) => [x.category, layoutText(x), x.area ? x.area + '㎡' : ''].filter(Boolean).map(esc).join(' · ') || '还没填户型';  // 列表卡片只放最简单的
  const specLine = (x) => [x.category, layoutText(x), x.area ? x.area + '㎡' : '', x.decoration, x.elevator ? '有电梯' : '没电梯'].filter(Boolean).map(esc).join(' · ');
  const LF0 = { kind: '', status: 'active', comm: '', cat: '', rooms: '', halls: '', amin: '', amax: '', elev: '' };
  const matchListing = (x, F, noStatus) => {
    const kw = (F.q || '').trim();
    if (!noStatus && F.status && x.status !== F.status) return false;
    if (F.kind && x.kind !== F.kind) return false;
    if (F.comm && x.community !== F.comm) return false;
    if (F.cat && x.category !== F.cat) return false;
    if (F.rooms !== '' && !(F.rooms === '5' ? x.rooms >= 5 : x.rooms === Number(F.rooms))) return false;
    if (F.halls !== '' && !(x.rooms != null && (F.halls === '3' ? x.halls >= 3 : (x.halls || 0) === Number(F.halls)))) return false;
    if (F.amin !== '' && !(x.area >= Number(F.amin))) return false;
    if (F.amax !== '' && !(x.area != null && x.area <= Number(F.amax))) return false;
    if (F.elev !== '' && !!x.elevator !== (F.elev === '1')) return false;
    return !kw || C.fuzzy([x.community + x.unit, x.category, layoutText(x), ...(x.owners || []).flatMap((o) => [o.name, o.phone]), ...(x.agents || []), x.note], kw);
  };
  // 筛选卡：每一行左边是名字，右边是选项，一眼看清
  const filterCard = (F, list, statuses) => {
    const seg = (k, opts) => `<div class="seg" style="grid-template-columns:repeat(${opts.length},1fr)">${opts.map(([v, t]) => `<button type="button" data-fs="${k}" data-v="${v}" aria-pressed="${F[k] === v}">${t}</button>`).join('')}</div>`;
    const sel = (k, opts) => `<select data-f="${k}" aria-label="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${F[k] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const LS = { active: '未成交', done: '已成交', off: '下架' };
    const comms = [...COMMUNITIES, ...[...new Set(list.map((x) => x.community).filter((c) => c && !COMMUNITIES.includes(c)))].sort((a, b) => a.localeCompare(b, 'zh'))];  // 后来录入的新小区排在后面
    return `<div class="card lf">
      <div class="lf-head"><h3>找房源</h3>${Object.keys(LF0).some((k) => F[k] !== LF0[k]) || F.q ? '<button type="button" data-fclear class="linkish">清空条件</button>' : ''}</div>
      <input id="lq" value="${esc(F.q || '')}" placeholder="搜坐落、房东、电话、备注" aria-label="搜索房源">
      <div class="lf-row"><span>买卖</span>${seg('kind', [['', '全部'], ['出售', '出售'], ['出租', '出租']])}</div>
      <div class="lf-row"><span>状态</span>${seg('status', [...statuses.map((s) => [s, LS[s]]), ['', '全部']])}</div>
      <div class="lf-row"><span>小区</span>${sel('comm', [['', '全部小区'], ...comms.map((c) => [c, c])])}</div>
      <div class="lf-row"><span>户型</span>${sel('cat', [['', '全部户型'], ...CATS.map((c) => [c, c])])}</div>
      <div class="lf-row"><span>室厅</span><div class="lf-pair">${sel('rooms', [['', '几室'], ['1', '1室'], ['2', '2室'], ['3', '3室'], ['4', '4室'], ['5', '5室以上']])}${sel('halls', [['', '几厅'], ['0', '0厅'], ['1', '1厅'], ['2', '2厅'], ['3', '3厅以上']])}</div></div>
      <div class="lf-row"><span>面积</span><div class="lf-range"><span>从</span><input data-f="amin" inputmode="decimal" value="${esc(F.amin)}" placeholder="例如 60" aria-label="面积从多少平方米"><span>到</span><input data-f="amax" inputmode="decimal" value="${esc(F.amax)}" placeholder="例如 90" aria-label="面积到多少平方米"><span>㎡</span></div></div>
      <div class="lf-row"><span>电梯</span>${seg('elev', [['1', '有电梯'], ['0', '没电梯']])}</div>
    </div>`;
  };
  const bindFilter = (root, F, redraw) => {
    const keep = (sel, fn) => Promise.resolve(redraw()).then(() => { const n = root.querySelector(sel); if (n) { n.focus(); fn(n); } });
    root.querySelectorAll('[data-fs]').forEach((b) => b.onclick = () => { const k = b.dataset.fs; F[k] = k === 'elev' && F[k] === b.dataset.v ? '' : b.dataset.v; redraw(); });  // 电梯再点一次就取消
    root.querySelectorAll('select[data-f]').forEach((el) => el.onchange = () => { F[el.dataset.f] = el.value; redraw(); });
    root.querySelectorAll('input[data-f]').forEach((el) => el.oninput = () => { F[el.dataset.f] = el.value.replace(/[^\d.]/g, ''); keep(`input[data-f="${el.dataset.f}"]`, (n) => n.setSelectionRange(n.value.length, n.value.length)); });
    const q = root.querySelector('#lq'); if (q) q.oninput = () => { F.q = q.value; const pos = q.selectionStart; keep('#lq', (n) => n.setSelectionRange(pos, pos)); };
    const c = root.querySelector('[data-fclear]'); if (c) c.onclick = () => { Object.assign(F, LF0, { q: '' }); redraw(); };
  };
  // 备注修改记录：一直显示，最新 3 条直接看到，更早的点开看
  const noteLogHTML = (x) => {
    const g = (x.note_log || []).slice().reverse();
    const row = (h) => `<div class="fb"><div class="small muted"><b>${esc(h.by)}</b>　${fmtTime(h.at)}</div><div>${h.note ? esc(h.note) : '<span class="muted">（清空了备注）</span>'}</div></div>`;
    return `<div class="stack" style="gap:6px"><span class="small muted">备注修改记录（${g.length} 次）</span>
      ${g.length ? `<div class="fb-list">${g.slice(0, 3).map(row).join('')}</div>${g.length > 3 ? `<details><summary class="small muted" style="cursor:pointer">更早的 ${g.length - 3} 次</summary><div class="fb-list" style="margin-top:6px">${g.slice(3).map(row).join('')}</div></details>` : ''}` : '<div class="small muted">还没有人改过备注</div>'}</div>`;
  };
  const LF = { ...LF0, q: '' };
  const priceText = (x) => x.price == null || x.price === '' ? '价格未填' : x.kind === '出租' ? `${Number(x.price).toLocaleString()} 元/月` : `${Number(x.price).toLocaleString()} 万`;
  const owners = (x) => (x.owners || []).map((o) => o.name).filter(Boolean).join('、') || '—';

  async function listings() {
    const list = await S.auntListings();
    if (!list) return pickName();
    const shown = list.filter((x) => matchListing(x, LF));
    const toFill = list.filter((x) => x.needs_info && x.mine);
    app.innerHTML = `<div class="wrap stack" style="max-width:560px">
      ${demoBar()}${tabs()}
      <button class="add-listing" id="l-add"><span class="plus">＋</span><span><b>录入新房源</b><span class="small">新拿到的房子在这里录，您就是维护人</span></span></button>
      ${toFill.length ? `<div class="todo-card stack" style="gap:8px"><div class="todo-head"><span class="todo-num">${toFill.length}</span><b>套房子的资料要您补一下</b></div>
        <div class="small">店里记账时自动建的，只有小区和坐落。您是房源维护人，请补上户型、面积这些。</div>
        ${toFill.map((x) => `<button class="todo-btn" data-fill="${x.id}"><span>📝 ${esc(x.community)} ${esc(x.unit)}</span><span>去补资料 ›</span></button>`).join('')}</div>` : ''}
      ${filterCard(LF, list, ['active', 'done'])}
      <div class="lf-count">找到 <b>${shown.length}</b> 套房源</div>
      ${shown.map((x) => `<button class="card listing${x.status === 'done' ? ' done' : ''}" data-l="${x.id}">
        <div class="lstrip ${x.kind === '出租' ? 'k-rent' : 'k-sale'}"><span>${x.kind}</span><span>${(LST[x.status] || LST.active)(x.kind)}</span></div>
        ${x.status === 'done' ? `<span class="seal" aria-label="已成交">${x.kind === '出租' ? '已租' : '已售'}</span>` : ''}
        <div class="row" style="gap:12px;flex-wrap:nowrap;align-items:flex-start">
          <div class="grow stack" style="min-width:0;text-align:left;gap:2px"><b style="font-size:18px">${esc(x.community)} ${esc(x.unit)}</b>
            <div class="small muted">${cardSpec(x)}</div>
            <div>${x.deal_price != null ? `<b class="num" style="font-size:18px;color:#c0392b">成交 ${Number(x.deal_price).toLocaleString()} ${x.kind === '出租' ? '元/月' : '万'}</b> <span class="small muted">挂牌 ${priceText(x)}</span>` : `<b class="num" style="font-size:18px;color:var(--accent)">${priceText(x)}</b>`}</div></div>
          ${x.photo_thumb ? `<img class="lphoto" data-lphoto="${x.id}" src="${x.photo_thumb}" alt="房子照片，点开看大图">` : ''}</div>
        </button>`).join('') || '<div class="card muted">没有符合条件的房源</div>'}
    </div>`;
    bindDemo(); bindTabs();
    bindFilter(app, LF, listings);
    app.querySelectorAll('[data-l]').forEach((b) => b.onclick = (e) => e.target.closest('[data-lphoto]') ? Photo.show(S.auntListingPhoto(Number(b.dataset.l))) : listingDetail(list.find((x) => String(x.id) === b.dataset.l), list));
    app.querySelectorAll('[data-fill]').forEach((b) => b.onclick = () => editListing(list.find((x) => String(x.id) === b.dataset.fill), list));
    $('#l-add').onclick = () => editListing(null, list);
  }
  // 业务员录入 / 修改房源。房源维护人只有第一次录入时选（默认自己），以后改不了，要换人找店面
  async function editListing(x, all) {
    const isNew = !x;
    x = x ? JSON.parse(JSON.stringify(x)) : { kind: '出售', community: '', unit: '', category: '', rooms: null, halls: null, area: '', decoration: '', price: '', elevator: false, owners: [], agents: [] };
    const me = isNew ? (await S.auntStatement()).name : '';
    const names = isNew ? (await S.auntNames()).map((n) => n.name) : [];
    if (isNew) x.agents = [me];
    const extra = [...new Set(all.map((l) => l.community).filter((c) => c && !COMMUNITIES.includes(c)))];
    const other = x.community && !COMMUNITIES.includes(x.community) && !extra.includes(x.community);
    const opt = (list, v) => list.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
    const nopt = (n, v, suffix) => Array.from({ length: n }, (_, i) => `<option value="${i}" ${v === i ? 'selected' : ''}>${i}${suffix}</option>`).join('');
    const oline = (o) => `<div class="oline"><input data-on value="${esc(o ? o.name : '')}" placeholder="房东名字" aria-label="房东名字"><input data-op value="${esc(o ? o.phone : '')}" placeholder="电话" inputmode="tel" aria-label="房东电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button><button type="button" class="mdel" data-odel aria-label="删掉这个房东">×</button></div>`;
    const canOwner = isNew || !!x.mine;  // 房东信息只有房源维护人（和店面）能改，别人只能看、拨打
    const oview = (o) => `<div class="oline nodel"><input value="${esc(o.name || '')}" readonly aria-label="房东名字"><input data-op value="${esc(o.phone || '')}" readonly aria-label="房东电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button></div>`;
    app.innerHTML = `<div class="wrap stack" style="max-width:560px">
      <button id="back" style="align-self:flex-start">‹ ${isNew ? '回到房源列表' : '不改了，返回'}</button>
      <h2 style="margin:0">${isNew ? '录入新房源' : `修改房子信息：${esc(x.community)} ${esc(x.unit)}`}</h2>
      ${x.needs_info ? '<div class="notice">这套是店里记账时自动建的，请把户型、面积这些补上。</div>' : ''}
      <div class="card stack" id="ph-box" style="gap:8px"></div>
      <div class="card stack">
        <div class="seg" role="group" aria-label="出售还是出租" style="grid-template-columns:repeat(2,1fr)">${['出售', '出租'].map((k) => `<button type="button" data-kind="${k}" aria-pressed="${x.kind === k}">${k}</button>`).join('')}</div>
        <label class="field">小区<select id="e-comm-sel"><option value="">请选择小区</option><option value="__other" ${other ? 'selected' : ''}>其他（新拓展的小区，自己填）</option><optgroup label="常用小区">${opt(COMMUNITIES, x.community)}</optgroup>${extra.length ? `<optgroup label="后来录入的小区">${opt(extra, x.community)}</optgroup>` : ''}</select></label>
        <input id="e-comm" value="${esc(other ? x.community : '')}" placeholder="写小区名字" aria-label="其他小区名字" ${other ? '' : 'hidden'}>
        <label class="field">坐落<input id="e-unit" value="${esc(x.unit)}" placeholder="例如：7幢2单元601"></label>
        <div id="e-dup" class="notice err" hidden></div>
        <label class="field">户型分类<select id="e-cat"><option value="">—</option>${opt(CATS, x.category)}</select></label>
        <div class="row" style="flex-wrap:nowrap" id="e-rh" ${x.category === '商铺' ? 'hidden' : ''}>
          <label class="field grow" style="min-width:0">几室<select id="e-rooms"><option value="">—</option>${nopt(8, x.rooms, '室')}</select></label>
          <label class="field grow" style="min-width:0">几厅<select id="e-halls"><option value="">—</option>${nopt(5, x.halls, '厅')}</select></label></div>
        <div class="row" style="flex-wrap:nowrap">
          <label class="field grow" style="min-width:0">面积（㎡）<input id="e-area" inputmode="decimal" value="${esc(x.area == null ? '' : x.area)}" placeholder="例如：118"></label>
          <label class="field grow" style="min-width:0">装修<select id="e-deco"><option value="">—</option>${opt(['毛坯', '简装', '精装', '豪装'], x.decoration)}</select></label></div>
        <div class="field"><span>电梯</span><div class="seg" style="grid-template-columns:repeat(2,1fr)"><button type="button" data-ev="1" aria-pressed="${!!x.elevator}">有电梯</button><button type="button" data-ev="0" aria-pressed="${!x.elevator}">没电梯</button></div></div>
        <label class="field"><span id="e-plabel">${x.kind === '出租' ? '月租（元）' : '总价（万元）'}</span><input id="e-price" inputmode="decimal" value="${esc(x.price == null ? '' : x.price)}" placeholder="例如：168"></label>
      </div>
      <div class="card stack"><span class="small muted">房东（名字、电话）</span>
        ${canOwner ? `<div id="olines" class="stack" style="gap:8px">${((x.owners || []).length ? x.owners : [null]).map(oline).join('')}</div>
        <button type="button" id="oadd" style="align-self:flex-start">＋ 再加一个房东</button>`
          : `<div class="stack" style="gap:8px">${(x.owners || []).map(oview).join('') || '<span class="muted">没写</span>'}</div><div class="small muted">房东信息只有房源维护人和店面能改。</div>`}</div>
      <div class="card stack" style="gap:6px"><span class="small muted">房源维护人</span>
        ${isNew ? `<div class="small muted">默认是您自己。和别人一起负责的话，把他们也点上。保存以后就定下来了，要换人只能找店面改。</div>
          <div class="chips">${names.map((n) => `<button type="button" class="chip" data-ag="${esc(n)}" aria-pressed="${x.agents.includes(n)}">${esc(n)}</button>`).join('')}</div>`
          : `<b style="font-size:18px">${esc((x.agents || []).join('、') || '—')}</b><div class="small muted">维护人不能在这里改，要换人请找店面。</div>`}</div>
      ${isNew ? '<label class="field">备注<textarea id="e-note" rows="2" placeholder="例如：满五唯一、钥匙在店里、随时看房"></textarea></label>' : ''}
      <div id="err" class="notice err" hidden></div>
      <button class="btn-primary btn-block" id="e-save" style="min-height:56px">${isNew ? '保存这套房源' : '保存修改'}</button>
    </div>`;
    window.scrollTo(0, 0);
    const phField = Photo.field($('#ph-box'), x.photo_thumb, () => S.auntListingPhoto(x.id));
    $('#back').onclick = () => isNew ? listings() : listingDetail(all.find((y) => y.id === x.id), all);
    const commVal = () => { const v = $('#e-comm-sel').value; return (v === '__other' ? $('#e-comm').value : v).trim(); };
    const key = (c, u) => (c + '|' + u).replace(/\s/g, '');
    const dup = () => { const k = key(commVal(), $('#e-unit').value); const d = commVal() && $('#e-unit').value.trim() && all.find((y) => y.id !== x.id && key(y.community, y.unit) === k);
      const box = $('#e-dup'); box.hidden = !d; if (d) box.textContent = `系统里已经有这套房子了（维护人 ${(d.agents || []).join('、') || '—'}），不能重复录入`; return !!d; };
    $('#e-comm-sel').onchange = () => { const o = $('#e-comm-sel').value === '__other'; $('#e-comm').hidden = !o; if (o) $('#e-comm').focus(); dup(); };
    $('#e-comm').oninput = $('#e-unit').oninput = dup;
    $('#e-cat').onchange = () => { $('#e-rh').hidden = $('#e-cat').value === '商铺'; };
    app.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => { x.kind = b.dataset.kind; app.querySelectorAll('[data-kind]').forEach((y) => y.setAttribute('aria-pressed', y === b)); $('#e-plabel').textContent = x.kind === '出租' ? '月租（元）' : '总价（万元）'; });
    app.querySelectorAll('[data-ev]').forEach((b) => b.onclick = () => { x.elevator = b.dataset.ev === '1'; app.querySelectorAll('[data-ev]').forEach((y) => y.setAttribute('aria-pressed', y === b)); });
    app.querySelectorAll('[data-ag]').forEach((b) => b.onclick = () => { const n = b.dataset.ag, i = x.agents.indexOf(n); if (i >= 0) x.agents.splice(i, 1); else x.agents.push(n); b.setAttribute('aria-pressed', i < 0); });
    if (canOwner) $('#oadd').onclick = () => $('#olines').insertAdjacentHTML('beforeend', oline(null));
    if (canOwner) $('#olines').onclick = (e) => { const d = e.target.closest('[data-odel]'); if (!d) return; const ls = app.querySelectorAll('#olines .oline'); if (ls.length > 1) d.closest('.oline').remove(); else d.closest('.oline').querySelectorAll('input').forEach((i) => { i.value = ''; }); };
    $('#e-save').onclick = async () => {
      const num = (v) => String(v).replace(/[^\d.]/g, '');
      if (!commVal()) return err('请选小区（不在列表里就选第一个“其他”，自己填）');
      if (!$('#e-unit').value.trim()) return err('请填坐落');
      if (dup()) return err('这套房子已经录过了，不能重复录入');
      if (isNew && !x.agents.length) return err('请至少选一个房源维护人');
      const shop = $('#e-cat').value === '商铺';
      const p = { kind: x.kind, community: commVal(), unit: $('#e-unit').value.trim(), category: $('#e-cat').value, rooms: shop ? '' : $('#e-rooms').value, halls: shop ? '' : $('#e-halls').value,
        area: num($('#e-area').value), decoration: $('#e-deco').value, elevator: !!x.elevator, price: num($('#e-price').value),
        owners: canOwner ? [...app.querySelectorAll('#olines .oline')].map((o) => ({ name: o.querySelector('[data-on]').value.trim(), phone: o.querySelector('[data-op]').value.trim() })).filter((o) => o.name || o.phone) : x.owners || [] };
      if (isNew) { p.agents = x.agents; p.note = $('#e-note').value.trim(); }
      const pc = phField.changed(); if (pc !== undefined) { p.photo = pc ? pc.photo : ''; p.photo_thumb = pc ? pc.photo_thumb : ''; }
      $('#e-save').disabled = true;
      try { const id = await S.auntListingSave(isNew ? null : x.id, p); const list = await S.auntListings(); const y = list.find((z) => z.id === id); if (y) listingDetail(y, list); else listings(); }
      catch (e) { $('#e-save').disabled = false; err(e.message); }
    };
  }
  const telLink = (o) => `<span class="telrow">${[esc(o.name), o.phone ? `<span class="num">${esc(o.phone)}</span><button type="button" class="ocall sm" data-call="${esc(o.phone)}" aria-label="拨打">📞</button>` : ''].filter(Boolean).join(' ')}</span>`;
  function listingDetail(x, all) {
    app.innerHTML = `<div class="wrap stack" style="max-width:560px">
      <button id="back" style="align-self:flex-start">‹ 回到房源列表</button>
      <div class="card stack" style="gap:6px">
        <div class="row" style="gap:10px;flex-wrap:nowrap"><span class="tc ${x.kind === '出租' ? 'tt-b' : 'tt-a'}">${x.kind}</span><h2 class="grow" style="margin:0">${esc(x.community)} ${esc(x.unit)}</h2></div>
        ${x.photo_thumb ? `<img class="ph-prev" id="l-photo" src="${x.photo_thumb}" alt="房子照片，点开放大">` : ''}
        ${x.deal_price != null ? `<div class="sold-line">${x.kind === '出租' ? '已租' : '已售'}，成交价 <b class="num">${Number(x.deal_price).toLocaleString()} ${x.kind === '出租' ? '元/月' : '万'}</b></div>` : ''}
        <div class="kv"><span>房源维护人</span><span>${esc((x.agents || []).join('、') || '—')}</span><span>户型分类</span><span>${esc(x.category || '—')}</span><span>几室几厅</span><span>${esc(layoutText(x) || '—')}</span><span>电梯</span><span>${x.elevator ? '有电梯' : '没电梯'}</span><span>面积</span><span>${x.area ? esc(x.area) + '㎡' : '—'}</span><span>装修</span><span>${esc(x.decoration || '—')}</span>
          <span>${x.kind === '出租' ? '月租' : '总价'}</span><span class="num"><b>${priceText(x)}</b></span><span>房东</span><span>${(x.owners || []).length ? x.owners.map(telLink).join('<br>') : '—'}</span></div>
        <button id="l-edit">修改房子信息</button>
        ${x.updated_by || x.created_by ? `<div class="small muted">${x.created_by ? esc(x.created_by) + ' 录入' : ''}${x.updated_by && x.updated_by !== x.created_by ? '，' + esc(x.updated_by) + ' 最后修改' : ''}</div>` : ''}
      </div>
      <div class="card stack"><h3>备注</h3>
        <textarea id="note" rows="3">${esc(x.note || '')}</textarea>
        <button id="note-save">保存备注</button>
        ${noteLogHTML(x)}</div>
      <div class="card stack"><h3>联系反馈（${x.feedback.length} 条）</h3>
        <textarea id="fb" rows="2" placeholder="写一条反馈，例如：今天带客户看了，客户觉得价格高"></textarea>
        <button class="btn-primary" id="fb-add">添加反馈</button>
        <div id="err" class="notice err" hidden></div>
        ${x.feedback.length ? `<div class="fb-list">${x.feedback.slice().reverse().map((f) => `<div class="fb"><div class="small muted"><b>${esc(f.author)}</b>　${fmtTime(f.created_at)}</div><div>${esc(f.content)}</div></div>`).join('')}</div>` : '<div class="small muted">还没有反馈</div>'}
      </div></div>`;
    window.scrollTo(0, 0);
    const reopen = async () => { const list = await S.auntListings(); const y = list && list.find((z) => z.id === x.id); if (y) listingDetail(y, list); else listings(); };
    $('#back').onclick = () => listings();
    if ($('#l-photo')) $('#l-photo').onclick = () => Photo.show(S.auntListingPhoto(x.id));
    $('#l-edit').onclick = async () => editListing(x, all || await S.auntListings());
    $('#note-save').onclick = async () => { try { await S.auntListingNote(x.id, $('#note').value.trim()); await reopen(); } catch (e) { err(e.message); } };
    $('#fb-add').onclick = async () => { const t = $('#fb').value.trim(); if (!t) return err('请先写反馈内容'); try { await S.auntListingFeedback(x.id, t); await reopen(); } catch (e) { err(e.message); } };
  }

  function err(msg) { const e = $('#err'); if (e) { e.textContent = msg; e.hidden = false; } }

  async function pickName() {
    const names = await S.auntNames();
    app.innerHTML = `<div class="wrap stack" style="max-width:520px">
      ${demoBar()}
      <h1>文城房产 · 结算确认</h1>
      <div class="muted">第一次打开，请点您自己的名字。</div>
      <div class="chips">${names.map((n) => `<button class="chip" data-n="${esc(n.name)}" >${esc(n.name)}</button>`).join('')}</div>
      <div class="small muted">换了手机也没关系，重新输一次店面发给您的密码就行。</div>
    </div>`;
    bindDemo();
    app.querySelectorAll('.chip').forEach((b) => b.onclick = () => askPhone(b.dataset.n));
  }

  function askPhone(name) {
    app.innerHTML = `<div class="wrap stack" style="max-width:520px">
      <h1>${esc(name)}，您好</h1>
      <form id="pf" class="card stack">
        <label class="field">请输入店面私下发给您的密码<input id="p4" inputmode="numeric" maxlength="6" pattern="\\d{4,6}" autocomplete="off" required style="font-size:28px;letter-spacing:.3em;text-align:center"></label>
        <div id="err" class="notice err" hidden></div>
        <button class="btn-primary" type="submit">确定</button>
        <button type="button" id="notme">我不是${esc(name)}，重新选</button>
      </form>
      <div class="small muted">只需要输入这一次，以后这部手机打开就直接是您的账。密码不要告诉别人，别人知道了就能看到您的钱。</div>
    </div>`;
    $('#p4').focus();
    $('#notme').onclick = pickName;
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try { await S.auntBind(name, $('#p4').value.trim()); start(); } catch (x) { err(x.message); }
    };
  }

  function dealCard(d, name) {
    const r = C.calcDeal(d); const mine = r.people[name] || 0;
    const roles = d.type === '合作' ? '合作单' : [d.type !== '新房' && d.listing_agents.includes(name) ? '房源方' : '', d.client_agents.includes(name) ? '客户方' : ''].filter(Boolean).join('、');
    const partners = (arr) => arr.length > 1 ? `，和${arr.filter((n) => n !== name).map(esc).join('、')}平分` : '';
    return { mine, html: `<div class="card stack" style="gap:6px">
      <div class="row" style="gap:10px"><span class="tc tt-${{ '二手买卖': 'a', '租房': 'b', '新房': 'c', '合作': 'd' }[d.type] || 'a'}">${{ '二手买卖': '二手', '租房': '租房', '新房': '新房', '合作': '合作' }[d.type] || esc(d.type)}</span><b style="font-size:18px">${esc(d.title || '（没写房子）')}</b></div>
      <span class="muted small"><span class="num">${d.deal_date}</span>${[d.type === '合作' ? '合作中介：' + esc(d.partner || '—') : '', d.type !== '新房' && d.owner_name ? '房东：' + esc(d.owner_name) : '', d.customer_name ? '客户：' + esc(d.customer_name) : ''].filter(Boolean).map((x) => '　' + x).join('')}</span>
      ${d.parent_id ? '<div class="small notice">这是之前那一单晚到账的返点，单独补记。原单不变，只要确认这一小笔。</div>' : ''}
      <div class="bd">
        <div class="bd-group">
          ${d.incomes.map((i) => `<span class="sub">${esc(i.type + (i.bank ? '（' + i.bank + '）' : '') + (i.person ? '（' + i.person + '）' : ''))}</span><span class="num sub">${C.fmt(C.toFen(i.amount))}</span>`).join('')}
          ${d.expenses.map((i) => `<span class="sub">减：${esc(i.type + (i.person ? '（' + i.person + '）' : '') + (i.memo ? '（' + i.memo + '）' : '') + (i.paid_by ? '（' + i.paid_by + '垫付）' : ''))}</span><span class="num sub">-${C.fmt(C.toFen(i.amount))}</span>`).join('')}
          ${r.isCoop ? `<span class="sub">减：合作中介拿一半</span><span class="num sub">-${C.fmt(r.partnerCut)}</span>` : ''}
          <span class="bd-key">总账</span><span class="num bd-key">${C.fmt(r.net)}</span></div>
        <div class="bd-group">${d.parent_id ? '<span class="sub" style="grid-column:1/-1">返点不扣店面维护</span>' : r.rate ? `<span>减：店面维护 ${r.rate}%</span><span class="num">-${C.fmt(r.maint)}</span>${r.otherIncome || r.expense ? `<span class="sub" style="grid-column:1/-1">只扣佣金部分：（佣金 ${C.fmt(r.commission)}${r.expense ? ' − 支出 ' + C.fmt(r.expense) : ''}）× ${r.rate}%${r.otherIncome ? '，返点 ' + C.fmt(r.otherIncome) + ' 不扣' : ''}</span>` : ''}` : `<span class="sub" style="grid-column:1/-1">${r.isCoop ? '合作单不扣店面维护' : '新房不扣店面维护'}</span>`}
          <span class="bd-key">纯利润</span><span class="num bd-key">${C.fmt(r.rest)}</span></div>
        <div class="bd-group">
          ${d.type !== '新房' && d.listing_agents.includes(name) ? `<span>房源方的业务员一半${partners(d.listing_agents)}${r.returns.listing.length ? '（含' + r.returns.listing.map((x) => x.type).join('、') + '）' : ''}</span><span class="num">${C.fmt(r.listingBlock - r.listing.store)}</span>` : ''}
          ${d.client_agents.includes(name) ? `<span>${r.isCoop ? '我们这一半里业务员的一半' : '客户方的业务员一半'}${partners(d.client_agents)}${r.returns.client.length ? '（含' + r.returns.client.map((x) => x.type).join('、') + '）' : ''}</span><span class="num">${C.fmt(r.clientBlock - r.client.store)}</span>` : ''}
          ${r.reimb[name] ? `<span>加：我先垫付的钱（店里还我）</span><span class="num">+${C.fmt(r.reimb[name])}</span>` : ''}
          <span class="bd-key">我这一单（${roles}）</span><span class="num bd-key">${C.fmt(mine)}</span></div>
      </div></div>` };
  }

  async function statement() {
    const st = await S.auntStatement();
    if (!st) return pickName();
    const { name, deals, settlements } = st;
    const toFill = ((await S.auntListings().catch(() => [])) || []).filter((x) => x.needs_info && x.mine);
    const pending = deals.filter((x) => x.deal.status === 'confirming' && !(x.confirmation && x.confirmation.status === 'ok'));
    const waitingOthers = deals.filter((x) => x.deal.status === 'confirming' && x.confirmation && x.confirmation.status === 'ok');
    const unsettled = deals.filter((x) => x.deal.status === 'locked' && !x.deal.settlement_id);
    const mineOf = (d) => C.calcDeal(d).people[name] || 0;
    const sumOf = (list) => list.reduce((a, x) => a + mineOf(x.deal), 0);

    // 客户信息只存一份：客户方有几位业务员时，谁先确认谁填，填好了别人能看到是谁填的
    const custTodo = (d) => {
      const filled = d.customer_name && (d.customer_phone || '').replace(/\D/g, '').length >= 7;
      const others = d.client_agents.filter((n) => n !== name);
      const by = d.customer_by && d.customer_by !== name ? (d.customer_by === '店面' ? '店面' : d.customer_by) : '';
      const when = d.customer_at ? new Date(d.customer_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      const head = filled
        ? `<b>✓ 客户信息${by ? '已由 ' + esc(by) + ' 填好' : '已经填好'}</b>${when ? `<span class="small muted">${esc(when)}</span>` : ''}<span class="small">看一下没问题，直接点“确认无误”就行。填错了可以在这里改。</span>`
        : `<b>您是客户方业务员，请补全客户信息（必须填，店里留存）</b>${others.length ? `<span class="small">这一单客户方还有 ${esc(others.join('、'))}。客户信息只要填一次：谁先确认谁来填，填好了大家都看得到是谁填的。</span>` : ''}`;
      return `<div class="todo-card stack" style="gap:8px">${head}
          <span class="small">客户（名字、电话）</span><div class="oline nodel"><input data-cn="${d.id}" data-orig="${esc(d.customer_name || '')}" value="${esc(d.customer_name || '')}" placeholder="客户名字" aria-label="客户名字"><input data-cp="${d.id}" data-orig="${esc(d.customer_phone || '')}" value="${esc(d.customer_phone || '')}" inputmode="tel" placeholder="手机号" aria-label="客户电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button></div></div>`;
    };
    const pendingHTML = pending.map((x) => {
      const d = x.deal, c = x.confirmation;
      return `<div class="stack" style="gap:8px">${d.reopen_count ? `<div class="notice">店面改过这一单${d.reopen_note ? '：' + esc(d.reopen_note) : ''}。请重新看一下，没问题再确认。</div>` : ''}${dealCard(d, name).html}
        ${d.client_agents.includes(name) && !d.parent_id ? custTodo(d) : ''}
        <button class="btn-primary btn-block" data-ok="${d.id}" style="font-size:20px;min-height:56px">确认无误</button>
        <div class="small muted">有疑问请直接在群里问，没问题再点确认。</div></div>`;
    }).join('<hr style="border:0;border-top:2px dashed var(--line);margin:6px 0">');
    // 客户方业务员随时能改客户名字、电话（别人看不到这里）
    const custBox = (d) => !d.parent_id && d.client_agents.includes(name) ? `<div class="card stack" style="gap:8px"><span class="small muted">客户（名字、电话）　只有客户方和店面能改</span>
      <div class="oline nodel" data-cdeal="${d.id}"><input data-cn value="${esc(d.customer_name || '')}" placeholder="客户名字" aria-label="客户名字"><input data-cp value="${esc(d.customer_phone || '')}" inputmode="tel" placeholder="手机号" aria-label="客户电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button></div>
      <button type="button" data-csave="${d.id}" style="align-self:flex-start">保存客户信息</button></div>` : '';
    // 每一单点开能看详细的账
    const listRows = (list) => list.map((x) => `<details class="deal-row"><summary class="row between"><span><span class="num muted small">${x.deal.deal_date.slice(5)}</span> ${esc(x.deal.title)}</span><span class="row" style="gap:6px;flex-wrap:nowrap"><b class="num">${C.fmt(mineOf(x.deal))}</b><span class="chev">›</span></span></summary>
      <div style="margin-top:8px">${dealCard(x.deal, name).html}${custBox(x.deal)}</div></details>`).join('');
    const stlHTML = settlements.map((s) => {
      const list = deals.filter((x) => x.deal.settlement_id === s.id);
      return `<details class="card settled"><summary class="row between" style="cursor:pointer"><b>${esc(s.name)}</b><b class="num">¥${C.fmt(sumOf(list))}</b></summary>
        <div class="stack" style="gap:4px;margin-top:8px">${listRows(list)}</div></details>`;
    }).join('');

    app.innerHTML = `<div class="wrap stack" style="max-width:560px">
      ${demoBar()}${tabs()}
      <h1>${esc(name)}，您好</h1>
      ${toFill.length ? `<button class="todo-card todo-link" id="go-fill"><div class="todo-head"><span class="todo-num">${toFill.length}</span><b>套房子的资料要您补一下 ›</b></div><div class="small">店里记账时自动建的，只有小区和坐落。您是房源维护人，请补上户型、面积这些。</div></button>` : ''}
      <div class="card stack" style="gap:4px"><div class="row between"><span>我一共成交</span><b class="num" style="font-size:22px">${deals.length} 单</b></div>
        <div class="row between small muted"><span>全部应得合计</span><span class="num">¥${C.fmt(sumOf(deals))}</span></div>
        <div class="small muted">每一单都在下面，按状态分开列出。</div></div>
      <div id="err" class="notice err" hidden></div>
      <h2>请您确认（${pending.length} 单）</h2>
      ${pendingHTML || '<div class="card muted">现在没有要确认的单子。</div>'}
      <h2>已确认（等店面统一结算）</h2>
      <div class="card confirmed stack" style="gap:6px">
        <div class="row between"><span>下次结算您应得</span><b class="num" style="font-size:26px">¥${C.fmt(sumOf(unsettled))}</b></div>
        ${listRows(unsettled) || '<div class="muted small">还没有</div>'}
        ${waitingOthers.length ? `<div class="small muted">另外有 ${waitingOthers.length} 单您已确认，还在等其他人确认：</div>${listRows(waitingOthers)}` : ''}
      </div>
      <h2>已结算</h2>
      ${stlHTML || '<div class="card muted">还没有结算过。</div>'}
      <div class="small muted">规则：每单收入减支出是总账，再扣店面维护是纯利润（只扣佣金部分的 10%，返点不扣；新房不扣）；佣金部分的纯利润房源方 20%、客户方 80%（新房全算客户方）；返点直接归一方：银行、装修返点归客户方，垫资返点归房源方，其他收入看店里选的哪一方；合作单总佣金一半给合作中介，我们这一半店面和业务员各一半；每一块业务员拿一半，由这一单的业务员平分。</div>
    </div>`;
    bindDemo(); bindTabs();
    if ($('#go-fill')) $('#go-fill').onclick = () => { view = 'listings'; start(); };
    app.querySelectorAll('[data-csave]').forEach((b) => b.onclick = async () => {
      const ln = app.querySelector(`[data-cdeal="${b.dataset.csave}"]`), cn = ln.querySelector('[data-cn]').value.trim(), cp = ln.querySelector('[data-cp]').value.trim();
      if (!cn) { err('请填客户名字'); return; } if (cp.replace(/\D/g, '').length < 7) { err('请填正确的客户电话'); return; }
      try { await S.auntSetCustomer(Number(b.dataset.csave), cn, cp); b.textContent = '已保存 ✓'; } catch (x) { err(x.message); }
    });
    app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.ok, cn = app.querySelector(`[data-cn="${id}"]`), cp = app.querySelector(`[data-cp="${id}"]`);
      if (cn && (!cn.value.trim() || cp.value.replace(/\D/g, '').length < 7)) {
        // 页面打开得早，可能别的客户方业务员刚刚已经填好了：先看一下最新的
        const fresh = await S.auntStatement().catch(() => null);
        const fd = fresh && fresh.deals.find((x) => String(x.deal.id) === id);
        if (fd && fd.deal.customer_name && fd.deal.customer_name !== cn.dataset.orig) { await statement(); err((fd.deal.customer_by || '别人') + ' 刚刚已经填好了客户信息，请看一下再确认'); return; }
      }
      if (cn && !cn.value.trim()) { err('请先填客户名字'); cn.focus(); return; }
      if (cp && cp.value.replace(/\D/g, '').length < 7) { err('请先填客户电话'); cp.focus(); return; }
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '确认后不能更改，再点一次'; return; }
      // 只有自己改过才送上去，免得旧页面上的内容把别人刚填的盖掉
      const changed = cn && (cn.value.trim() !== cn.dataset.orig || cp.value.trim() !== cp.dataset.orig);
      try { await S.auntConfirm(Number(id), 'ok', '', changed ? { name: cn.value.trim(), phone: cp.value.trim() } : null); statement(); } catch (x) { err(x.message); }
    });
  }

  async function start() {
    try { await (view === 'listings' ? listings() : statement()); } catch (e) { app.innerHTML = `<div class="wrap"><div class="notice err">打不开：${esc(e.message)}。请检查网络后再试。</div></div>`; }
  }
  start();
  // 切回这个页面时自动刷新（别人刚填的、刚确认的都能看到）；正在填的时候不刷新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || view === 'listings') return;
    const typing = [...app.querySelectorAll('input[data-orig]')].some((i) => i.value.trim() !== i.dataset.orig) || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (!typing && !app.querySelector('[data-armed="1"]') && !document.querySelector('.sheet')) start();
  });
})();
