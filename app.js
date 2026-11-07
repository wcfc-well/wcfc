// 店面用的主界面：记账、结算（按月份勾选单子结算）、业务员名单
(function () {
  const S = window.Store, C = window.Calc, U = window.StoreUtil;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = C.fmt;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const monthLabel = (m) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
  const CONFIRM_URL = () => new URL('confirm.html', location.href).href;

  const state = { tab: 'deals', month: '', agents: [], deals: [], settlements: [], confs: [], selected: new Set(), openMonths: null };
  const app = $('#app');
  // 打印 / 存 PDF 时把收起的明细全部展开
  window.addEventListener('beforeprint', () => document.querySelectorAll('#statement details').forEach((x) => { x.open = true; }));

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  async function run(fn) { try { return await fn(); } catch (e) { toast(e.message || '出错了，请再试一次'); throw e; } }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('链接已复制，可以发到群里'); }
    catch (e) { const i = $('#copy-src'); if (i) { i.focus(); i.select(); } toast('请长按链接手动复制'); }
  }
  // 需要点两次的按钮（代替弹窗确认）
  function twice(btn, warnText, fn) {
    let armed = false;
    btn.onclick = async () => { if (!armed) { armed = true; btn.textContent = warnText; return; } await fn(); };
  }

  async function loadAll() {
    [state.agents, state.deals, state.settlements, state.confs] = await Promise.all([S.listAgents(), S.listDeals(), S.listSettlements(), S.listConfirmations()]);
    const ids = new Set(state.deals.filter(canSettle).map((d) => d.id));
    state.selected.forEach((id) => { if (!ids.has(id)) state.selected.delete(id); });
  }
  const canSettle = (d) => d.status === 'locked' && !d.settlement_id;
  const stlOf = (d) => d.settlement_id ? state.settlements.find((s) => s.id === d.settlement_id) : null;
  const dealsOf = (sid) => state.deals.filter((d) => d.settlement_id === sid).sort((a, b) => a.deal_date.localeCompare(b.deal_date));
  const sortNames = (names) => { const o = state.agents.map((a) => a.name); return names.slice().sort((a, b) => o.indexOf(a) - o.indexOf(b)); };
  // 这一单的确认进度
  function progress(d) {
    const who = sortNames(U.people(d));
    const cm = Object.fromEntries(state.confs.filter((c) => c.deal_id === d.id).map((c) => [c.agent_name, c]));
    const okN = who.filter((n) => cm[n] && cm[n].status === 'ok').length;
    return { who, cm, okN, qN: 0 };
  }
  function statusPill(d) {
    if (d.settlement_id) return '<span class="pill settled">已结算</span>';
    if (d.status === 'locked') return '<span class="pill ok">已确认</span>';
    const p = progress(d); return `<span class="pill warn">待确认 ${p.okN}/${p.who.length}${p.qN ? ' · 有疑问' : ''}</span>`;
  }
  const rowClass = () => '';
  // 房屋类型：醒目的实心标签，放在最前面
  const typeTag = (t, big) => `<span class="tc tt-${{ '二手买卖': 'a', '租房': 'b', '新房': 'c' }[t] || 'a'}${big ? ' tc-big' : ''}">${{ '二手买卖': '二手', '租房': '租房', '新房': '新房' }[t] || esc(t)}</span>`;
  // 状态：像快递进度一样的三步进度条（记账 → 业务员确认 → 结算），上面一句话写清楚现在到哪一步
  function steps(d) {
    const p = progress(d);
    const confirmed = d.status === 'locked', settled = !!d.settlement_id;
    const s = stlOf(d);
    const left = p.who.length - p.okN;
    let now, cls;
    if (settled) { now = `已结算完成${s ? '（' + esc(s.name.replace(/（.*）/, '')) + '）' : ''}`; cls = 'fin'; }
    else if (confirmed) { now = '业务员都确认了，等结算'; cls = 'mid'; }
    else if (p.qN) { now = `有 ${p.qN} 人有疑问，请看一下`; cls = 'ask'; }
    else { now = `等业务员确认，还差 ${left} 人`; cls = 'wait'; }
    const node = (state, num, label) => `<div class="node ${state}"><i>${state === 'done' ? '✔' : num}</i><span>${label}</span></div>`;
    return `<div class="stepper-wrap">
      <div class="now now-${cls}">现在：${now}</div>
      <div class="stepper">
        ${node(confirmed ? 'done' : 'cur', 1, `业务员确认 ${p.okN}/${p.who.length}`)}<div class="bar ${confirmed ? 'done' : ''}"></div>
        ${node(settled ? 'done' : confirmed ? 'cur' : '', 2, '结算')}
      </div></div>`;
  }
  const partyText = (d) => [d.type !== '新房' && d.owner_name ? '房东：' + d.owner_name : '', d.customer_name ? '客户：' + d.customer_name : ''].filter(Boolean).join('　');
  const whoText = (d) => [d.type !== '新房' && d.listing_agents.length ? '房源方：' + d.listing_agents.join('、') : '', d.client_agents.length ? '客户方：' + d.client_agents.join('、') : ''].filter(Boolean).join('　') || '还没选业务员';

  // ---------- 分账明细（编辑页和单张结算单共用） ----------
  const itemName = (i) => i.type + (i.bank ? `（${i.bank}）` : '') + (i.person ? `（${i.person}）` : '');
  // 介绍费、维护费按房东方 / 客户方绑定同一个介绍人
  const PERSON_SIDE = { '房东介绍费': 'owner', '房东维护费': 'owner', '客户介绍费': 'cust', '客户维护费': 'cust' };
  // forStatement=true 时用于结算单：不显示店面拿多少
  function breakdownHTML(d, forStatement) {
    const r = C.calcDeal(d);
    const lines = (items, minus) => items.map((i) => `<span class="sub">${minus ? '减：' : ''}${esc(itemName(i))}</span><span class="num sub">${minus ? '-' : ''}${f(C.toFen(i.amount))}</span>`).join('');
    const block = (title, blk, side, agents) => {
      if (!blk) return '';
      const ppl = agents.length ? agents.map((n) => `<span>${esc(n)}</span><span class="num">${f(side.agents[n] || 0)}</span>`).join('') : '<span class="muted">还没选业务员</span><span></span>';
      return `<div class="bd-group"><span class="bd-title" style="grid-column:auto">${title}</span><b class="num" style="color:var(--accent)">${f(blk)}</b>
        ${forStatement ? '' : `<span>店面一半</span><span class="num">${f(side.store)}</span>`}
        <span class="sub" style="grid-column:1/-1">业务员一半 ${f(blk - side.store)}，${agents.length > 1 ? agents.length + ' 人平分' : '归这位业务员'}：</span>${ppl}</div>`;
    };
    return `<div class="bd">
      <div class="bd-group"><span class="bd-title">一、总账</span>
        ${lines(d.incomes)}<span>收入合计</span><span class="num">${f(r.income)}</span>
        ${lines(d.expenses, true)}<span>支出合计</span><span class="num">-${f(r.expense)}</span>
        <span class="bd-key">总账（收入 − 支出）</span><span class="num bd-key">${f(r.net)}</span></div>
      <div class="bd-group"><span class="bd-title">二、纯利润</span>
        <span>总账</span><span class="num">${f(r.net)}</span>
        ${r.rate ? `<span>减：店面维护成本 ${r.rate}%</span><span class="num">-${f(r.maint)}</span>` : '<span class="sub" style="grid-column:1/-1">新房不扣店面维护成本，总账就是纯利润</span>'}
        <span class="bd-key">纯利润</span><span class="num bd-key">${f(r.rest)}</span></div>
      ${d.type === '新房' ? block('三、客户方 100%（新房，没有房源方）', r.clientBlock, r.client, d.client_agents)
        : block('三、房源方 20%', r.listingBlock, r.listing, d.listing_agents) + block('四、客户方 80%', r.clientBlock, r.client, d.client_agents)}
      ${forStatement ? '' : `<div class="bd-group bd-store"><span class="bd-title">这一单合计</span>
        <span class="bd-key" style="border:0;padding:0">店面</span><span class="num bd-key" style="border:0;padding:0">${f(r.store)}</span>
        <span class="bd-key">业务员</span><span class="num bd-key">${f(r.net - r.store)}</span>
        ${Object.entries(r.people).map(([n, v]) => `<span class="sub">　${esc(n)}</span><span class="num sub">${f(v)}</span>`).join('')}</div>`}
      ${r.warnings.map((w) => `<div class="notice">${esc(w)}</div>`).join('')}
    </div>`;
  }

  // 一单的完整明细：类型、日期、房东客户、业务员、收支和怎么分（结算确认、结算记录、结算单共用）
  function dealDetail(d, forStatement, open = true) {
    const r = C.calcDeal(d);
    return `<details class="dd card"${open ? ' open' : ''}><summary><div class="row" style="gap:8px;flex-wrap:nowrap">${typeTag(d.type)}<b class="grow">${esc(d.title || '（没写房子）')}</b><b class="num">${f(r.net)}</b></div>
        <div class="small muted"><span class="num">${d.deal_date}</span>　${esc(partyText(d))}</div>
        <div class="small muted">业务员　${esc(whoText(d))}</div><span class="dd-hint no-print"></span></summary>
      ${breakdownHTML(d, forStatement)}${d.note ? `<div class="small muted">备注：${esc(d.note)}</div>` : ''}</details>`;
  }

  // ---------- 外框 ----------
  function shell(inner, extra = '') {
    const demo = S.mode === 'demo' ? '<span class="badge-demo">演示数据</span>' : '';
    app.innerHTML = `
      <div class="wrap" id="main">
        <div class="topbar"><h1>店面记账</h1>${demo}</div>
        <div id="view" class="stack">${inner}</div>
      </div>${extra}
      <nav class="tabbar" aria-label="主菜单">
        <button data-tab="deals" aria-current="${state.tab === 'deals'}">记账</button>
        <button data-tab="settle" aria-current="${state.tab === 'settle'}">结算</button>
        <button data-tab="agents" aria-current="${state.tab === 'agents'}">业务员</button>
      </nav>`;
    app.querySelectorAll('.tabbar button').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; render(); });
  }
  function render() {
    if (state.tab === 'deals') return renderDeals();
    if (state.tab === 'settle') return renderSettle();
    return renderAgents();
  }
  async function reload() { await loadAll(); render(); }

  // ---------- 记账 ----------
  function renderDeals() {
    const months = [...new Set(state.deals.map((d) => d.deal_date.slice(0, 7)))].sort().reverse();
    const list = state.deals.filter((d) => !state.month || d.deal_date.startsWith(state.month));
    let inc = 0, net = 0; list.forEach((d) => { const r = C.calcDeal(d); inc += r.income; net += r.net; });
    const cards = list.map((d) => {
      const r = C.calcDeal(d);
      const warn = r.warnings.length ? '<span class="pill warn">要检查</span>' : '';
      return `<button class="card with-badge" data-id="${d.id}">${typeTag(d.type, true)}<div class="stack grow" style="gap:4px">
        <div class="row" style="gap:10px"><b class="grow" style="font-size:18px">${esc(d.title || '（没写房子）')}</b>${warn}</div>
        <div class="muted small num">${d.deal_date}</div>
        <div class="row between small"><span class="muted">收入 <span class="num">${f(r.income)}</span>　支出 <span class="num">${f(r.expense)}</span></span><span>总账 <b class="num">${f(r.net)}</b></span></div>
        ${partyText(d) ? `<div class="small muted">${esc(partyText(d))}</div>` : ''}
        <div class="small muted">业务员　${esc(whoText(d))}</div>
        ${steps(d)}
      </div></button>`;
    }).join('');
    shell(`
      <div class="row">
        <select id="month" class="grow" aria-label="月份"><option value="">全部月份</option>${months.map((m) => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <button class="btn-primary" id="add">＋ 记一单</button>
      </div>
      <div class="tiles">
        <div class="tile"><div class="small muted">单数</div><div class="v num">${list.length}</div></div>
        <div class="tile"><div class="small muted">收入合计</div><div class="v num">${f(inc)}</div></div>
        <div class="tile"><div class="small muted">总账合计</div><div class="v num">${f(net)}</div></div>
      </div>
      ${cards || '<div class="card muted">还没有记账。点“记一单”开始。</div>'}`);
    $('#month').onchange = (e) => { state.month = e.target.value; renderDeals(); };
    $('#add').onclick = () => openDeal(null);
    app.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => openDeal(state.deals.find((d) => String(d.id) === b.dataset.id)));
  }

  function openSheet(html, label) {
    const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', label);
    sheet.innerHTML = html; document.body.appendChild(sheet); return sheet;
  }

  function openDeal(deal) {
    const d = deal ? JSON.parse(JSON.stringify(deal)) : { deal_date: today(), type: '二手买卖', title: '', owner_name: '', customer_name: '', incomes: [], expenses: [], listing_agents: [], client_agents: [], note: '' };
    const locked = deal && deal.status === 'locked';
    const p = deal ? progress(deal) : null;
    const names = state.agents.filter((a) => a.active || d.listing_agents.includes(a.name) || d.client_agents.includes(a.name)).map((a) => a.name);
    const dis = locked ? 'disabled' : '';
    const moneyRows = (kind, types) => types.map((t) => {
      const it = d[kind].find((x) => x.type === t);
      const bank = t === '银行返点' ? `<input class="bank" data-bank="1" value="${esc(it && it.bank || '')}" placeholder="哪家银行，例如：农行" ${it && !locked ? '' : 'disabled'} aria-label="哪家银行" style="grid-column:1/-1">` : '';
      const side = kind === 'expenses' && PERSON_SIDE[t];
      const pv = side ? ((it && it.person) || (d.expenses.find((x) => PERSON_SIDE[x.type] === side && x.person) || {}).person || '') : '';
      const person = side ? `<input class="person" data-person="${side}" data-pt="${t}" value="${esc(pv)}" placeholder="介绍人名字" ${it && !locked ? '' : 'disabled'} aria-label="${t}的介绍人">` : '';
      return `<div class="money-row${side ? ' with-person' : ''}"><label><input type="checkbox" data-kind="${kind}" data-t="${t}" ${it ? 'checked' : ''} ${dis}>${t}</label>${person}
        <input type="number" inputmode="decimal" step="0.01" min="0" data-kind="${kind}" data-t="${t}" value="${it ? it.amount : ''}" placeholder="0" ${it && !locked ? '' : 'disabled'} aria-label="${t}金额">${bank}</div>`;
    }).join('');
    const chips = (field) => names.map((n) => `<button type="button" class="chip" data-f="${field}" data-n="${esc(n)}" aria-pressed="${d[field].includes(n)}" ${dis}>${esc(n)}</button>`).join('');
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="row between"><h2>${deal ? '这一单' : '记一单'}</h2>${deal ? typeTag(deal.type) : ''}</div>
        ${deal ? steps(deal) : ''}
        ${deal ? '<button class="btn-primary btn-block" id="s-stmt">这一单的结算单（发到群里）</button>' : ''}
        ${locked ? `<div class="notice err stack" style="gap:8px"><div>相关业务员都已确认，这一单已锁定，不能直接改。${deal.settlement_id ? '已经结算过了。' : '等结算时再算钱。'}</div>
          ${deal.settlement_id ? '<div class="small">发现算错了？先到“结算”页的结算记录里撤销那次结算，再回来点“撤回重改”。</div>'
            : `<div class="stack" style="gap:6px"><b>发现算错了？</b><input id="re-why" placeholder="写一下哪里错了，例如：佣金少写了 1000" aria-label="哪里错了">
              <button id="s-reopen">撤回重改（大家要重新确认）</button></div>`}</div>` : ''}
        ${deal && deal.reopen_count && !locked ? `<div class="notice">这一单撤回重改过${deal.reopen_count > 1 ? ' ' + deal.reopen_count + ' 次' : ''}${deal.reopen_note ? '，原因：' + esc(deal.reopen_note) : ''}。改好后保存，业务员要重新确认。</div>` : ''}
        ${deal && deal.status === 'confirming' ? '<div class="notice">业务员们正在确认这一单。现在改的话，大家要重新确认。</div>' : ''}
        ${deal && deal.status !== 'draft' ? `<div class="card stack" style="gap:6px"><h3>业务员确认情况</h3>
          ${p.who.map((n) => { const c = p.cm[n]; return `<div class="row between"><span>${esc(n)}</span>${c && c.status === 'ok' ? '<span class="pill ok">已确认</span>' : '<span class="pill gray">还没确认</span>'}</div>`; }).join('')}</div>` : ''}
        <div class="card stack">
          <label class="field">日期<input type="date" id="f-date" value="${d.deal_date}" ${dis}></label>
          <div style="display:flex;flex-direction:column;gap:4px"><span class="small muted">房屋类型</span>
            <div class="seg" role="group" aria-label="房屋类型">${C.DEAL_TYPES.map((t) => `<button type="button" data-type="${t}" aria-pressed="${d.type === t}" ${dis}>${t}</button>`).join('')}</div></div>
          <label class="field">房子 / 说明<input id="f-title" value="${esc(d.title)}" placeholder="例如：幸福小区 3-502" ${dis}></label>
          <div class="row" style="flex-wrap:nowrap">
            <label class="field grow" id="owner-box" style="min-width:0">房东名字<input id="f-owner" value="${esc(d.owner_name || '')}" placeholder="例如：刘先生" ${dis}></label>
            <label class="field grow" style="min-width:0">客户名字<input id="f-cust" value="${esc(d.customer_name || '')}" placeholder="例如：陈女士" ${dis}></label>
          </div>
        </div>
        <div class="card"><h3>收入（勾选这一单有的）</h3><div id="income-rows"></div></div>
        <div class="card"><h3>这一单的支出</h3><div id="expense-rows"></div>
          <div class="small muted" style="margin-top:6px">房东介绍费和房东维护费的介绍人是同一个，写一个另一个自动填上；客户那边也一样。</div></div>
        <div class="card stack" id="listing-box"><h3>房源方业务员（可多选）</h3><div class="chips">${chips('listing_agents')}</div></div>
        <div class="card stack"><h3>客户方业务员（可多选）</h3><div class="chips">${chips('client_agents')}</div></div>
        <label class="field">备注<textarea id="f-note" rows="2" ${dis}>${esc(d.note)}</textarea></label>
        <div class="card stack"><h2>这一单怎么分</h2><div id="preview" aria-live="polite"></div></div>

      </div>
      <div class="sheet-actions">
        <button id="s-cancel">${locked ? '返回' : '取消'}</button>
        ${deal && !locked ? '<button id="s-del" class="btn-danger">删除</button>' : ''}
        ${locked ? '' : '<button id="s-save" class="btn-primary">保存</button>'}
      </div>`, '记一单');
    const close = () => sheet.remove();

    function drawIncomes() { $('#income-rows', sheet).innerHTML = moneyRows('incomes', C.INCOME_BY_TYPE[d.type]); $('#expense-rows', sheet).innerHTML = moneyRows('expenses', C.EXPENSE_BY_TYPE[d.type]); }
    function collect() {
      d.deal_date = $('#f-date', sheet).value; d.title = $('#f-title', sheet).value.trim(); d.note = $('#f-note', sheet).value.trim();
      d.owner_name = d.type === '新房' ? '' : $('#f-owner', sheet).value.trim(); d.customer_name = $('#f-cust', sheet).value.trim();
      ['incomes', 'expenses'].forEach((k) => {
        d[k] = [...sheet.querySelectorAll(`input[type=checkbox][data-kind=${k}]`)].filter((c) => c.checked).map((c) => {
          const v = sheet.querySelector(`input[type=number][data-kind=${k}][data-t="${c.dataset.t}"]`).value;
          const it = { type: c.dataset.t, amount: Number(v || 0) };
          const b = c.dataset.t === '银行返点' && sheet.querySelector('input[data-bank]');
          if (b && b.value.trim()) it.bank = b.value.trim();
          const side = k === 'expenses' && PERSON_SIDE[c.dataset.t];
          const pv = side && sheet.querySelector(`input[data-pt="${c.dataset.t}"]`).value.trim();
          if (pv) it.person = pv;
          return it;
        });
      });
    }
    function preview() {
      collect();
      $('#listing-box', sheet).hidden = d.type === '新房';
      $('#owner-box', sheet).hidden = d.type === '新房';
      const view = { ...d, listing_agents: d.type === '新房' ? [] : d.listing_agents };
      $('#preview', sheet).innerHTML = breakdownHTML(view);
    }
    sheet.addEventListener('input', (e) => {
      // 同一边（房东 / 客户）的介绍费和维护费共用一个介绍人
      if (e.target.dataset.person) sheet.querySelectorAll(`input[data-person=${e.target.dataset.person}]`).forEach((x) => { if (x !== e.target) x.value = e.target.value; });
      preview();
    });
    sheet.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') { const a = sheet.querySelector(`input[type=number][data-kind=${e.target.dataset.kind}][data-t="${e.target.dataset.t}"]`); a.disabled = !e.target.checked; if (e.target.checked) a.focus(); else a.value = ''; const pi = sheet.querySelector(`input[data-pt="${e.target.dataset.t}"]`); if (pi) { pi.disabled = !e.target.checked; if (e.target.checked && !pi.value) { const sib = [...sheet.querySelectorAll(`input[data-person=${pi.dataset.person}]`)].find((x) => x.value); if (sib) pi.value = sib.value; } } if (e.target.dataset.t === '银行返点') { const bk = sheet.querySelector('input[data-bank]'); bk.disabled = !e.target.checked; if (!e.target.checked) bk.value = ''; } }
      preview();
    });
    sheet.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
      collect(); d.type = b.dataset.type;
      d.incomes = d.incomes.filter((i) => C.INCOME_BY_TYPE[d.type].includes(i.type)); // 换类型时去掉不属于这个类型的佣金
      d.expenses = d.expenses.filter((i) => C.EXPENSE_BY_TYPE[d.type].includes(i.type));
      sheet.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      drawIncomes(); preview();
    });
    sheet.querySelectorAll('.chip').forEach((b) => b.onclick = () => {
      const arr = d[b.dataset.f], n = b.dataset.n, i = arr.indexOf(n);
      if (i >= 0) arr.splice(i, 1); else arr.push(n);
      b.setAttribute('aria-pressed', i < 0); preview();
    });
    $('#s-cancel', sheet).onclick = close;
    if ($('#s-stmt', sheet)) $('#s-stmt', sheet).onclick = () => openStatement({ title: '单笔结算单', sub: `${deal.deal_date}　${deal.title || ''}`, deals: [deal] });
    if ($('#s-reopen', sheet)) twice($('#s-reopen', sheet), '确定撤回？再点一次', async () => {
      const why = $('#re-why', sheet).value.trim();
      await run(() => S.reopenDeal(deal.id, why)); close(); await reload(); toast('已撤回，改好后保存，业务员会重新确认');
      const fresh = state.deals.find((x) => x.id === deal.id); if (fresh) openDeal(fresh);
    });
    if ($('#s-del', sheet)) twice($('#s-del', sheet), '再点一次删除', async () => { await run(() => S.deleteDeal(d.id)); close(); toast('已删除'); await reload(); });
    const save = async (send) => {
      collect();
      if (!d.deal_date) return toast('请选日期');
      if (!d.incomes.length) return toast('请至少勾选一项收入');
      if (d.type === '新房') d.listing_agents = [];
      if (!U.people(d).length) return toast('请先选这一单的业务员');
      await run(() => S.saveDeal(d, send)); close(); toast(deal ? '已保存' : '已保存，打开这一单可以生成结算单发到群里'); await reload();
    };
    if ($('#s-save', sheet)) $('#s-save', sheet).onclick = () => save(true); // 保存后直接进入待确认
    drawIncomes(); preview();
  }

  // ---------- 结算：按月份展开，一单一单勾选 ----------
  function renderSettle() {
    const months = [...new Set(state.deals.map((d) => d.deal_date.slice(0, 7)))].sort().reverse();
    if (!state.openMonths) state.openMonths = new Set(months);
    const ready = state.deals.filter(canSettle);
    const waiting = state.deals.filter((d) => d.status !== 'locked').length;
    const monthHTML = months.filter((m) => ready.some((d) => d.deal_date.startsWith(m))).map((m) => {
      const open = ready.filter((d) => d.deal_date.startsWith(m)).sort((a, b) => a.deal_date.localeCompare(b.deal_date));
      const rows = open.map((d) => {
        const r = C.calcDeal(d);
        return `<label class="card deal-row" style="cursor:pointer">
          <input type="checkbox" data-sel="${d.id}" ${state.selected.has(d.id) ? 'checked' : ''} aria-label="选这一单">
          <div class="info"><div class="row" style="gap:8px">${typeTag(d.type)}<b>${esc(d.title || '（没写房子）')}</b></div>
            <div class="small muted"><span class="num">${d.deal_date.slice(5)}</span>　${esc(whoText(d))}</div>
            <div class="small">业务员这一单共得 <b class="num">${f(r.net - r.store)}</b></div></div>
        </label>`;
      }).join('');
      return `<details class="month" data-m="${m}" ${state.openMonths.has(m) ? 'open' : ''}>
        <summary><b>${monthLabel(m)}</b><span class="small muted">${open.length} 单可结算</span></summary>
        <div class="month-body">
          <button class="small" data-all="${m}" style="align-self:flex-start;min-height:36px;padding:4px 10px">${open.every((d) => state.selected.has(d.id)) ? '取消全选' : '全选这个月'}</button>
          ${rows}
        </div></details>`;
    }).join('');
    const stlHTML = state.settlements.map((s) => {
      const ds = dealsOf(s.id); const t = C.calcPeriod(ds).totals;
      return `<button class="card stack settled" style="gap:4px" data-sid="${s.id}">
        <div class="row between"><b>${esc(s.name)}</b><span class="pill settled">已结算</span></div>
        <div class="small muted">${ds.length} 单　总账 <span class="num">${f(t.net)}</span>　业务员合计 <span class="num">${f(t.net - t.store)}</span></div></button>`;
    }).join('');
    const sel = state.deals.filter((d) => state.selected.has(d.id));
    const selNet = sel.reduce((a, d) => a + C.calcDeal(d).net, 0);
    shell(`
      <h2>结算</h2>
      <div class="reports">
        <button class="report" id="summary"><b>业务员结算单</b><span>几个月合成一张，发到群里<br>不显示店面</span></button>
        <button class="report inner" id="summary-in"><b>店面对账单</b><span>同样的单子，加上店面的钱<br>只给自己看</span></button>
        <button class="report inner" id="income"><b>店面收入</b><span>按月份看店面<br>一共赚了多少</span></button>
      </div>
      <div class="notice info">这里只列出<b>业务员都确认了、还没结算</b>的单子。勾选要结算的，点下面的“结算”。随时都可以结算，不用等满两个月。</div>
      ${waiting ? `<div class="small muted">另外还有 ${waiting} 单在等业务员确认，确认完会自动出现在这里（去“记账”页看进度）。</div>` : ''}
      <h2>可以结算的单子（${ready.length}）</h2>
      ${monthHTML || '<div class="card muted">现在没有可以结算的单子。</div>'}
      <h2 style="margin-top:8px">结算记录</h2>
      ${stlHTML || '<div class="card muted">还没有结算过。</div>'}`,
      sel.length ? `<div class="selbar"><span class="grow">已选 <b>${sel.length}</b> 单，总账 <b class="num">${f(selNet)}</b></span><button id="clear-sel">清空</button><button class="btn-primary" id="do-settle">结算</button></div>` : '');
    app.querySelectorAll('details.month').forEach((el) => el.addEventListener('toggle', () => { if (el.open) state.openMonths.add(el.dataset.m); else state.openMonths.delete(el.dataset.m); }));
    app.querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => { const id = Number(c.dataset.sel); if (c.checked) state.selected.add(id); else state.selected.delete(id); renderSettle(); });
    app.querySelectorAll('[data-all]').forEach((b) => b.onclick = () => {
      const open = state.deals.filter((d) => d.deal_date.startsWith(b.dataset.all) && canSettle(d));
      const all = open.every((d) => state.selected.has(d.id));
      open.forEach((d) => all ? state.selected.delete(d.id) : state.selected.add(d.id)); renderSettle();
    });
    app.querySelectorAll('[data-stmt]').forEach((b) => b.onclick = () => { const d = state.deals.find((x) => String(x.id) === b.dataset.stmt); openStatement({ title: '单笔结算单', sub: `${d.deal_date}　${d.title || ''}`, deals: [d] }); });
    app.querySelectorAll('[data-sid]').forEach((b) => b.onclick = () => openSettlement(Number(b.dataset.sid)));
    $('#summary').onclick = () => openSummaryPicker(false);
    $('#summary-in').onclick = () => openSummaryPicker(true);
    $('#income').onclick = () => openStoreIncome();
    if ($('#clear-sel')) $('#clear-sel').onclick = () => { state.selected.clear(); renderSettle(); };
    if ($('#do-settle')) $('#do-settle').onclick = () => confirmSettle(sel);
  }

  function confirmSettle(sel) {
    const now = new Date();
    const name = `${now.getMonth() + 1}月${now.getDate()}日结算（${sel.length}单）`;
    const deals = sel.slice().sort((a, b) => a.deal_date.localeCompare(b.deal_date));
    const t = C.calcPeriod(deals).totals;
    const who = sortNames(U.participants(deals));
    const sheet = openSheet(`
      <div class="wrap stack">
        <h2>结算这 ${deals.length} 单</h2>
        <label class="field">这次结算的名字<input id="st-name" value="${esc(name)}"></label>
        <h3>这次一共</h3>
        <div class="tiles">
          <div class="tile"><div class="small muted">总账</div><div class="v num">${f(t.net)}</div></div>
          <div class="tile"><div class="small muted">店面合计</div><div class="v num">${f(t.store)}</div></div>
          <div class="tile"><div class="small muted">业务员合计</div><div class="v num">${f(t.net - t.store)}</div></div>
        </div>
        <div class="card"><div class="tablewrap"><table><thead><tr><th>姓名</th><th class="r">应得</th></tr></thead><tbody>
          <tr><td><b>店面</b></td><td class="r num"><b>${f(t.store)}</b></td></tr>
          ${who.map((n) => `<tr><td>${esc(n)}</td><td class="r num">${f(t.people[n] || 0)}</td></tr>`).join('')}</tbody></table></div></div>
        <h3>每一单的明细（点开看）</h3>
        ${deals.map((d) => dealDetail(d, false, false)).join('')}
        <div class="notice info">这 ${deals.length} 单业务员都已经确认过了。结算后会变成蓝色“已结算”，业务员在链接里能看到这次结算的金额。结算错了可以撤销。</div>
      </div>
      <div class="sheet-actions"><button id="st-cancel">取消</button><button class="btn-primary" id="st-go">确认结算</button></div>`, '结算');
    $('#st-cancel', sheet).onclick = () => sheet.remove();
    $('#st-go', sheet).onclick = async () => {
      const n = $('#st-name', sheet).value.trim() || name;
      const sid = await run(() => S.createSettlement(n, deals.map((d) => d.id)));
      sheet.remove(); state.selected.clear(); await reload(); toast('已结算'); openSettlement(Number(sid));
    };
  }

  function openSettlement(sid) {
    const s = state.settlements.find((x) => x.id === sid);
    if (!s) return;
    const ds = dealsOf(sid); const t = C.calcPeriod(ds).totals;
    const who = sortNames(U.participants(ds));
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="row between"><h2>${esc(s.name)}</h2><span class="pill settled">已结算</span></div>
        <div class="muted small">结算时间 ${new Date(s.created_at).toLocaleString('zh-CN')}</div>
        <div class="tiles">
          <div class="tile"><div class="small muted">总账</div><div class="v num">${f(t.net)}</div></div>
          <div class="tile"><div class="small muted">店面合计</div><div class="v num">${f(t.store)}</div></div>
          <div class="tile"><div class="small muted">业务员合计</div><div class="v num">${f(t.net - t.store)}</div></div>
        </div>
        <div class="card"><div class="tablewrap"><table>
          <thead><tr><th>姓名</th><th class="r">应得</th></tr></thead>
          <tbody>${who.map((n) => `<tr><td>${esc(n)}</td><td class="r num">${f(t.people[n] || 0)}</td></tr>`).join('')}</tbody>
        </table></div></div>
        <h3>包含的单子（都已确认，点开看明细）</h3>
        ${ds.map((d) => dealDetail(d, false, false)).join('')}
        <button class="btn-primary btn-block" id="stmt">看结算单 / 存成 PDF</button>
        <button class="btn-danger btn-block" id="cancel-stl">撤销这次结算</button>
      </div>
      <div class="sheet-actions"><button id="close" class="btn-block">返回</button></div>`, s.name);
    const close = () => sheet.remove();
    $('#close', sheet).onclick = close;
    $('#stmt', sheet).onclick = () => openStatement({ title: '结算单', sub: s.name, deals: ds, settled: true });
    twice($('#cancel-stl', sheet), '撤销后这些单子变回“待结算”，再点一次', async () => { await run(() => S.cancelSettlement(sid)); close(); await reload(); toast('已撤销'); });
  }

  function openSummaryPicker(internal) {
    const months = [...new Set(state.deals.map((d) => d.deal_date.slice(0, 7)))].sort().reverse();
    const sheet = openSheet(`
      <div class="wrap stack">
        <h2>${internal ? '店面对账单' : '业务员结算单'}</h2>
        ${internal ? '<div class="notice err small">只给店面自己看：包括每位业务员和店面各拿多少，用来对账。不要发到群里。</div>'
          : '<div class="notice info small">发到群里用：写清每位业务员一共应得多少，上面不显示店面拿多少。</div>'}
        <div class="card stack"><h3>1. 选月份</h3>${months.map((m) => `<label class="row" style="gap:10px"><input type="checkbox" data-m="${m}" checked style="width:22px;height:22px;min-height:0">${monthLabel(m)}</label>`).join('')}</div>
        <div class="card stack"><h3>2. 截止到哪一单</h3>
          <select id="sp-end" aria-label="截止到哪一单"></select>
          <div class="small muted" id="sp-count"></div></div>
      </div>
      <div class="sheet-actions"><button id="sp-cancel">取消</button><button class="btn-primary" id="sp-go">生成${internal ? '店面对账单' : '业务员结算单'}</button></div>`, '结算单');
    const picked = () => {
      const ms = [...sheet.querySelectorAll('[data-m]')].filter((c) => c.checked).map((c) => c.dataset.m);
      return state.deals.filter((d) => ms.includes(d.deal_date.slice(0, 7))).sort((a, b) => a.deal_date.localeCompare(b.deal_date) || a.id - b.id);
    };
    const count = () => {
      const list = picked(); const i = list.findIndex((d) => String(d.id) === $('#sp-end', sheet).value);
      $('#sp-count', sheet).textContent = list.length ? `这张结算单包括 ${i + 1} 单（从 ${list[0].deal_date} 开始）` : '';
    };
    const fill = () => {
      const list = picked(); const sel = $('#sp-end', sheet); const keep = sel.value;
      sel.innerHTML = list.map((d, i) => `<option value="${d.id}">${d.deal_date}　${esc(d.title || '（没写房子）')}${i === list.length - 1 ? '（最后一单）' : ''}</option>`).join('') || '<option value="">请先选月份</option>';
      sel.value = list.some((d) => String(d.id) === keep) ? keep : (list.length ? String(list[list.length - 1].id) : '');
      count();
    };
    sheet.querySelectorAll('[data-m]').forEach((c) => c.onchange = fill);
    $('#sp-end', sheet).onchange = count;
    fill();
    $('#sp-cancel', sheet).onclick = () => sheet.remove();
    const make = (internal) => {
      const list = picked();
      if (!list.length) return toast('请至少选一个月');
      const i = list.findIndex((d) => String(d.id) === $('#sp-end', sheet).value);
      const deals = list.slice(0, i + 1); const last = deals[deals.length - 1];
      const ms = [...new Set(deals.map((d) => d.deal_date.slice(0, 7)))].sort();
      sheet.remove();
      const span = ms.length === 1 ? monthLabel(ms[0]) : `${monthLabel(ms[0])} 至 ${monthLabel(ms[ms.length - 1])}`;
      openStatement({ title: internal ? '对账单（内部）' : '业务员结算单', sub: `${span}，截止到 ${last.deal_date} ${last.title || ''}`, deals, showStatus: true, internal });
    };
    $('#sp-go', sheet).onclick = () => make(internal);
  }

  // ---------- 店面收入（只给妈妈看）：选从哪个月到哪个月，按月汇总，跨年时加年小计 ----------
  function openStoreIncome(from, to) {
    const now = today().slice(0, 7);
    const dm = state.deals.map((d) => d.deal_date.slice(0, 7));
    const first = [...dm, now].sort()[0], lastM = [...dm, now].sort().reverse()[0];
    const all = []; for (let m = first; m <= lastM; m = (() => { let y = +m.slice(0, 4), mo = +m.slice(5) + 1; if (mo > 12) { y++; mo = 1; } return `${y}-${String(mo).padStart(2, '0')}`; })()) all.push(m);
    const y0 = now.slice(0, 4);
    from = from || `${y0}-01`; to = to || now;
    if (from > to) [from, to] = [to, from];
    const list = state.deals.filter((d) => { const m = d.deal_date.slice(0, 7); return m >= from && m <= to; });
    const months = [...new Set(list.map((d) => d.deal_date.slice(0, 7)))].sort();
    const row = (deals) => { const t = C.calcPeriod(deals).totals; return { n: deals.length, net: t.net, maint: t.maint, store: t.store, agents: t.net - t.store, income: t.income, expense: t.expense }; };
    const tr = (label, r, bold) => { const B = (x) => bold ? `<b>${x}</b>` : x; return `<tr${bold ? ' class="subtotal"' : ''}><td>${B(label)}</td><td class="r num">${B(r.n)}</td><td class="r num">${B(f(r.net))}</td><td class="r num">${B(f(r.maint))}</td><td class="r num"><b>${f(r.store)}</b></td><td class="r num">${B(f(r.agents))}</td></tr>`; };
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    const multiYear = years.length > 1;
    const body = years.map((y) => {
      const ms = months.filter((m) => m.startsWith(y));
      const rows = ms.map((m) => tr(multiYear ? monthLabel(m) : `${Number(m.slice(5))}月`, row(list.filter((d) => d.deal_date.startsWith(m))))).join('');
      return rows + (multiYear ? tr(`${y}年小计`, row(list.filter((d) => d.deal_date.startsWith(y))), true) : '');
    }).join('');
    const tot = row(list);
    const span = from === to ? monthLabel(from) : `${monthLabel(from)} 至 ${monthLabel(to)}`;
    const opt = (sel) => all.slice().reverse().map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="card stack no-print" style="gap:10px">
          <div class="row" style="flex-wrap:nowrap;gap:8px"><label class="field grow" style="min-width:0">从<select id="in-from">${opt(from)}</select></label><label class="field grow" style="min-width:0">到<select id="in-to">${opt(to)}</select></label></div>
          ${window.NO_PRINT ? '' : '<button class="btn-primary" id="print">打印 / 存成 PDF</button>'}
        </div>
        <div class="card stack">
          <div><h1>店面收入</h1><div class="muted">${span}</div><div class="muted small">只给店面自己看，不要发到群里。</div></div>
          <div class="tiles">
            <div class="tile"><div class="small muted">总账</div><div class="v num">${f(tot.net)}</div></div>
            <div class="tile"><div class="small muted">店面一共得</div><div class="v num">${f(tot.store)}</div></div>
            <div class="tile"><div class="small muted">业务员一共得</div><div class="v num">${f(tot.agents)}</div></div>
          </div>
          <div class="tablewrap"><table><thead><tr><th>月份</th><th class="r">单数</th><th class="r">总账</th><th class="r">维护成本</th><th class="r">店面合计</th><th class="r">业务员合计</th></tr></thead><tbody>
            ${body || '<tr><td colspan="6" class="muted">这段时间没有单子</td></tr>'}
            ${tr('合计', tot, true)}
          </tbody></table></div>
          <div class="small muted">店面合计 = 每单 10% 维护成本（新房不扣）+ 房源方和客户方里店面的一半。这段时间收入 ${f(tot.income)}，支出 ${f(tot.expense)}。</div>
        </div>
      </div>
      <div class="sheet-actions"><button id="iclose" class="btn-block">返回</button></div>`, '店面收入');
    sheet.id = 'statement'; document.body.classList.add('printing');
    const close = () => { sheet.remove(); document.body.classList.remove('printing'); };
    $('#iclose', sheet).onclick = close;
    const go = (a, b) => { close(); openStoreIncome(a, b); };
    $('#in-from', sheet).onchange = () => go($('#in-from', sheet).value, $('#in-to', sheet).value);
    $('#in-to', sheet).onchange = () => go($('#in-from', sheet).value, $('#in-to', sheet).value);
    if ($('#print', sheet)) $('#print', sheet).onclick = () => window.print();
  }

  // ---------- 结算单（可打印 / 存 PDF） ----------
  function openStatement({ title, sub, deals, settled, showStatus, onClose, internal }) {
    const sum = C.calcPeriod(deals); const t = sum.totals;
    const who = sortNames(U.participants(deals));
    const agentsTotal = Object.values(t.people).reduce((a, b) => a + b, 0);
    const stTxt = (d) => d.settlement_id ? '已结算' : d.status === 'locked' ? '已确认' : '待确认';
    const single = deals.length === 1;
    const d0 = deals[0];
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="row between no-print"><span class="muted small">结算单预览</span>${window.NO_PRINT ? '' : '<button class="btn-primary" id="print">打印 / 存成 PDF</button>'}</div>
        ${window.NO_PRINT ? '<div class="notice no-print small">这是网页预览版，不能打印。正式版这里有“打印 / 存成 PDF”按钮。</div>' : '<div class="notice info no-print small">手机上：点“打印 / 存成 PDF”，打印机选“另存为 PDF”。Mac 上：打印窗口左下角选“存储为 PDF”。</div>'}
        <div class="card stack">
          <div class="row between"><div><h1>店面${title}</h1><div class="muted">${esc(sub)}</div></div>
            ${settled ? '<span class="stamp">已结算</span>' : ''}</div>
          ${internal ? '<div class="notice err"><b>店面内部对账用，含店面收入，不要发到群里。</b></div>' : ''}
          ${single ? `
            <div class="kv"><span>房屋类型</span><span>${esc(d0.type)}</span>${d0.type !== '新房' ? `<span>房东</span><span>${esc(d0.owner_name || '—')}</span>` : ''}<span>客户</span><span>${esc(d0.customer_name || '—')}</span><span>房源方业务员</span><span>${esc(d0.type === '新房' ? '无（新房）' : d0.listing_agents.join('、') || '—')}</span><span>客户方业务员</span><span>${esc(d0.client_agents.join('、') || '—')}</span><span>状态</span><span>${stTxt(d0)}</span></div>
            ${breakdownHTML(d0, true)}` : `
          <h3>一、汇总</h3>
          <div class="bd">
            <div class="bd-group"><span>总收入</span><span class="num">${f(t.income)}</span><span>总支出</span><span class="num">-${f(t.expense)}</span>
              <span class="bd-key">总账（收入 − 支出）</span><span class="num bd-key">${f(t.net)}</span></div>
            <div class="bd-group"><span>减：店面维护成本（新房不扣）</span><span class="num">-${f(t.maint)}</span>
              <span class="bd-key">纯利润</span><span class="num bd-key">${f(t.net - t.maint)}</span></div>
            ${internal ? `<div class="bd-group"><span>店面维护成本</span><span class="num">${f(t.maint)}</span><span>房源方、客户方里店面的一半</span><span class="num">${f(t.store - t.maint)}</span>
              <span class="bd-key">店面合计</span><span class="num bd-key">${f(t.store)}</span></div>` : ''}
            <div class="bd-group"><span class="bd-key" style="border:0;padding:0">业务员合计</span><span class="num bd-key" style="border:0;padding:0">${f(agentsTotal)}</span></div>
            ${internal ? `<div class="bd-group"><span class="small muted" style="grid-column:1/-1">核对：店面合计 + 业务员合计 = 总账</span><span>${f(t.store)} + ${f(agentsTotal)}</span><span class="num">${f(t.store + agentsTotal)}</span></div>` : ''}
          </div>`}
          <h3>${single ? '每人应得' : '二、每人应得'}</h3>
          <div class="tablewrap"><table><thead><tr><th>姓名</th><th class="r">应得（元）</th>${single ? '<th>确认</th>' : '<th>单数</th>'}</tr></thead><tbody>
            ${internal && !single ? `<tr class="subtotal"><td><b>店面</b></td><td class="r num"><b>${f(t.store)}</b></td><td>${deals.length}</td></tr>` : ''}
            ${who.map((n) => `<tr><td>${esc(n)}</td><td class="r num">${f(t.people[n] || 0)}</td>${single ? `<td>${(() => { const c = progress(d0).cm[n]; return c && c.status === 'ok' ? '已确认' : '待确认'; })()}</td>` : `<td>${deals.filter((d) => U.involves(d, n)).length}</td>`}</tr>`).join('')}
          </tbody></table></div>
          ${single ? '' : `<h3>三、每单明细</h3>
          <div class="tablewrap"><table><thead><tr><th>日期</th><th>房子</th><th class="r">总账</th>${internal ? '<th class="r">店面</th>' : ''}<th>业务员</th>${showStatus ? '<th>状态</th>' : ''}</tr></thead><tbody>
            ${sum.rows.map(({ deal: d, r }) => `<tr><td class="num">${d.deal_date.slice(5)}</td><td>${esc(d.title)}<div class="small muted">${d.type}</div></td><td class="r num">${f(r.net)}</td>${internal ? `<td class="r num"><b>${f(r.store)}</b></td>` : ''}
              <td class="small">${Object.entries(r.people).map(([n, v]) => `${esc(n)} ${f(v)}`).join('<br>')}</td>${showStatus ? `<td class="small">${stTxt(d)}</td>` : ''}</tr>`).join('')}
          </tbody></table></div>
          <h3>四、每一单的详细记录</h3>
          ${deals.map((d) => dealDetail(d, !internal, false)).join('')}`}
          ${single && d0.status !== 'locked' ? `<div class="notice info">请相关业务员核对后，打开确认链接点“确认无误”：${esc(CONFIRM_URL())}</div>` : ''}
          <div class="small muted">分账规则：每单总账 = 收入 − 支出；扣 10% 店面维护成本后是纯利润（新房不扣，总账就是纯利润）；纯利润按房源方 20%、客户方 80% 分（新房全部算客户方）；每一块店面和业务员各一半，业务员那一半由这一单的业务员平分。除不尽的零头归业务员。</div>
          <div class="small muted">生成时间：${new Date().toLocaleString('zh-CN')}</div>
        </div>
      </div>
      <div class="sheet-actions"><button id="sclose" class="btn-block">返回</button></div>`, title);
    sheet.id = 'statement';
    document.body.classList.add('printing');
    $('#sclose', sheet).onclick = () => { sheet.remove(); document.body.classList.remove('printing'); if (onClose) onClose(); };
    if ($('#print', sheet)) $('#print', sheet).onclick = () => { sheet.querySelectorAll('details').forEach((x) => x.open = true); window.print(); };
  }

  // ---------- 业务员 ----------
  function renderAgents() {
    const rows = state.agents.map((a) => {
      const ds = state.deals.filter((d) => U.involves(d, a.name)); const sum = ds.reduce((x, d) => x + (C.calcDeal(d).people[a.name] || 0), 0);
      const pill = a.active ? (a.device_token ? '<span class="pill ok">已登记</span>' : '<span class="pill gray">没登记</span>') : '<span class="pill gray">已停用</span>';
      return `<button class="agent-row${a.active ? '' : ' off'}" data-perf="${esc(a.name)}"><b class="an">${esc(a.name)}</b><span class="muted small grow">${ds.length} 单 · <span class="num">${f(sum)}</span></span>${pill}<span class="muted">›</span></button>`;
    }).join('');
    shell(`
      <div class="card stack">
        <h3>业务员确认链接</h3>
        <input id="copy-src" readonly value="${esc(CONFIRM_URL())}" aria-label="确认链接">
        <button id="copy">复制链接</button>
        <div class="small muted">所有业务员用同一个链接。第一次打开选自己的名字，输入手机号后 4 位，手机就记住她了。换手机或点错了，点她的名字，里面有“重置手机登记”。</div>
      </div>
      <h2>业务员名单（${state.agents.filter((a) => a.active).length} 人）</h2>
      <div class="row" style="flex-wrap:nowrap"><input id="new-name" class="grow" style="min-width:0" placeholder="新来的业务员名字" aria-label="新来的业务员名字"><input id="new-ph" inputmode="numeric" maxlength="4" style="width:6.5em" placeholder="手机后4位" aria-label="手机号后 4 位"><button id="add-agent">添加</button></div>
      <div class="small muted">点名字看她的每一单，手机号、重置登记、停用也在里面。</div>
      <div class="card agent-list">${rows}</div>
      <div class="row">
        ${S.mode === 'demo' ? '<button id="demo-reset">恢复演示数据</button><a class="btn" href="confirm.html">打开业务员确认页（演示）</a>' : '<button id="logout">退出登录</button>'}
      </div>`);
    $('#copy').onclick = () => copy(CONFIRM_URL());
    $('#add-agent').onclick = async () => {
      const n = $('#new-name').value.trim(), v = $('#new-ph').value.trim();
      if (!n) return toast('请填名字');
      if (!/^\d{4}$/.test(v)) return toast('请填手机号后 4 位（4 个数字）');
      if (state.agents.some((a) => a.name === n)) return toast('已经有这个名字了');
      await run(() => S.saveAgent({ name: n, phone4: v })); await reload(); toast('已添加 ' + n);
    };
    app.querySelectorAll('[data-perf]').forEach((b) => b.onclick = () => openAgent(b.dataset.perf));
    if ($('#demo-reset')) $('#demo-reset').onclick = () => { S.demoReset(); location.reload(); };
    if ($('#logout')) $('#logout').onclick = async () => { await S.logout(); location.reload(); };
  }

  // ---------- 某位业务员的业绩：成交了哪些单、每单拿多少 ----------
  function openAgent(name) {
    const a = state.agents.find((x) => x.name === name);
    const ds = state.deals.filter((d) => U.involves(d, name)).sort((a, b) => b.deal_date.localeCompare(a.deal_date));
    const mine = (d) => C.calcDeal(d).people[name] || 0;
    const tot = (list) => list.reduce((x, d) => x + mine(d), 0);
    const settled = ds.filter((d) => d.settlement_id), ready = ds.filter(canSettle), waiting = ds.filter((d) => d.status !== 'locked');
    const role = (d) => [d.type !== '新房' && d.listing_agents.includes(name) ? '房源方' : '', d.client_agents.includes(name) ? '客户方' : ''].filter(Boolean).join('、');
    const stTxt = (d) => d.settlement_id ? '已结算' : d.status === 'locked' ? '已确认，等结算' : '等确认';
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="row between no-print"><span class="muted small">业务员业绩</span>${window.NO_PRINT ? '' : '<button class="btn-primary" id="print">打印 / 存成 PDF</button>'}</div>
        <div class="card stack">
          <h1>${esc(name)} 的成交记录</h1>
          <div class="tiles">
            <div class="tile"><div class="small muted">成交单数</div><div class="v num">${ds.length}</div></div>
            <div class="tile"><div class="small muted">应得合计</div><div class="v num">${f(tot(ds))}</div></div>
          </div>
          <div class="kv small"><span>已结算（${settled.length} 单）</span><span class="num">${f(tot(settled))}</span>
            <span>已确认、等结算（${ready.length} 单）</span><span class="num">${f(tot(ready))}</span>
            <span>还在等确认（${waiting.length} 单）</span><span class="num">${f(tot(waiting))}</span></div>
          <h3>每一单</h3>
          <div class="small muted no-print">点年份、月份展开；点任何一单，看这一单的结算单。</div>
          ${(() => {
            if (!ds.length) return '<div class="muted">还没有成交</div>';
            const line = (d) => `<button class="deal-line" data-d="${d.id}">
              <div class="row" style="gap:8px;flex-wrap:nowrap">${typeTag(d.type)}<b class="grow">${esc(d.title)}</b><b class="num">${f(mine(d))}</b><span class="muted no-print">›</span></div>
              <div class="small muted"><span class="num">${d.deal_date}</span>　负责：${role(d)}　${stTxt(d)}</div></button>`;
            const group = (list, key) => list.reduce((m, d) => { const k = key(d); (m[k] = m[k] || []).push(d); return m; }, {});
            const years = group(ds, (d) => d.deal_date.slice(0, 4));
            const firstY = Object.keys(years).sort().reverse()[0];
            return Object.keys(years).sort().reverse().map((y) => {
              const months = group(years[y], (d) => d.deal_date.slice(0, 7));
              const firstM = Object.keys(months).sort().reverse()[0];
              return `<details class="yr"${y === firstY ? ' open' : ''}><summary><b>${y}年</b><span class="muted small">${years[y].length} 单</span><b class="num">${f(tot(years[y]))}</b></summary>
                ${Object.keys(months).sort().reverse().map((m) => `<details class="mo"${y === firstY && m === firstM ? ' open' : ''}><summary><span class="grow">${Number(m.slice(5))}月</span><span class="muted small">${months[m].length} 单</span><b class="num">${f(tot(months[m]))}</b></summary>
                  ${months[m].map(line).join('')}</details>`).join('')}</details>`;
            }).join('');
          })()}
        </div>
        ${a ? `<div class="card stack no-print" style="gap:10px">
          <div class="row between"><h3>手机登记</h3>${a.active ? (a.device_token ? '<span class="pill ok">已登记手机</span>' : '<span class="pill gray">还没登记</span>') : '<span class="pill gray">已停用</span>'}</div>
          <div class="row">
            <label class="field grow">手机号后 4 位<input inputmode="numeric" maxlength="4" id="ph" value="${esc(a.phone4)}" placeholder="例如 1234"></label>
            <button id="ph-save" style="align-self:flex-end">保存</button>
          </div>
          <div class="row">
            ${a.device_token ? '<button id="a-reset">重置手机登记</button>' : ''}
            <button id="a-active">${a.active ? '停用' : '恢复'}</button>
          </div>
          <div class="small muted">换手机或登记错了，点“重置手机登记”，她就能重新登记。不在店里干了可以停用，以前的单子还在。</div>
        </div>` : ''}
      </div>
      <div class="sheet-actions"><button id="aclose" class="btn-block">返回</button></div>`, name);
    sheet.id = 'statement'; document.body.classList.add('printing');
    const close = () => { sheet.remove(); document.body.classList.remove('printing'); };
    $('#aclose', sheet).onclick = close;
    if ($('#print', sheet)) $('#print', sheet).onclick = () => { sheet.querySelectorAll('details').forEach((x) => x.open = true); window.print(); };
    sheet.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const d = state.deals.find((x) => String(x.id) === b.dataset.d); close();
      openStatement({ title: '单笔结算单', sub: `${d.deal_date}　${d.title || ''}`, deals: [d], onClose: () => openAgent(name) });
    });
    const again = async (msg) => { await reload(); close(); openAgent(name); if (msg) toast(msg); };
    if ($('#ph-save', sheet)) $('#ph-save', sheet).onclick = async () => {
      const v = $('#ph', sheet).value.trim();
      if (v && !/^\d{4}$/.test(v)) return toast('请填 4 位数字');
      await run(() => S.saveAgent({ ...a, phone4: v })); await again('已保存');
    };
    if ($('#a-reset', sheet)) $('#a-reset', sheet).onclick = async () => { await run(() => S.resetBinding(a.id)); await again('已重置，她可以重新登记了'); };
    if ($('#a-active', sheet)) $('#a-active', sheet).onclick = async () => { await run(() => S.saveAgent({ ...a, active: !a.active })); await again(a.active ? '已停用' : '已恢复'); };
  }

  // ---------- 登录 ----------
  function renderLogin() {
    app.innerHTML = `<div class="wrap stack" style="max-width:420px;padding-top:40px">
      <h1>店面记账</h1><div class="muted">请用店面账号登录（每台手机/电脑登录一次即可）</div>
      <form id="lf" class="card stack">
        <label class="field">邮箱<input type="email" id="lf-email" autocomplete="username" required></label>
        <label class="field">密码<input type="password" id="lf-pw" autocomplete="current-password" required></label>
        <button class="btn-primary" type="submit">登录</button>
      </form></div>`;
    $('#lf').onsubmit = async (e) => { e.preventDefault(); await run(() => S.login($('#lf-email').value.trim(), $('#lf-pw').value)); start(); };
  }

  async function start() {
    if (!(await S.session())) return renderLogin();
    await run(loadAll); render();
  }
  start();
})();
