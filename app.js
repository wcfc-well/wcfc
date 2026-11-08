// 店面用的主界面：记账、结算（按月份勾选单子结算）、业务员名单
(function () {
  const S = window.Store, C = window.Calc, U = window.StoreUtil, Photo = window.Photo;
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
  const f = C.fmt;
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const monthLabel = (m) => `${m.slice(0, 4)}年${Number(m.slice(5, 7))}月`;
  const CONFIRM_URL = () => new URL('confirm.html', location.href).href;

  const state = { tab: 'deals', month: '', dq: '', dstat: '', agents: [], deals: [], settlements: [], confs: [], listings: [], lf: { q: '' }, selected: new Set(), openMonths: null };
  const app = $('#app');
  // 打印 / 存 PDF 时把收起的明细全部展开
  window.addEventListener('beforeprint', () => document.querySelectorAll('#statement details').forEach((x) => { x.open = true; }));

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  async function run(fn) { try { return await fn(); } catch (e) { toast(e.message || '出错了，请再试一次'); throw e; } }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制，可以粘贴发出去'); return; } catch (e) { /* 有些安卓浏览器没有这个功能，换老办法 */ }
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    t.remove();
    if (ok) toast('已复制，可以粘贴发出去');
    else { const i = $('#copy-src'); if (i) { i.focus(); i.select(); } toast('这个浏览器不让自动复制，请长按手动复制'); }
  }
  // 需要点两次的按钮（代替弹窗确认）
  function twice(btn, warnText, fn) {
    let armed = false;
    btn.onclick = async () => { if (!armed) { armed = true; btn.textContent = warnText; return; } await fn(); };
  }

  async function loadAll() {
    [state.agents, state.deals, state.settlements, state.confs, state.listings, state.nudges, state.pushSubs] = await Promise.all([S.listAgents(), S.listDeals(), S.listSettlements(), S.listConfirmations(), S.listListings().catch(() => []), (S.listNudges ? S.listNudges() : Promise.resolve([])).catch(() => []), (S.listPushSubs ? S.listPushSubs() : Promise.resolve([])).catch(() => [])]);
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
  const typeTag = (t, big) => `<span class="tc tt-${{ '二手买卖': 'a', '租房': 'b', '新房': 'c', '合作': 'd' }[t] || 'a'}${big ? ' tc-big' : ''}">${{ '二手买卖': '二手', '租房': '租房', '新房': '新房', '合作': '合作' }[t] || esc(t)}</span>`;
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
  const partyText = (d) => [d.type === '合作' ? '合作中介：' + (d.partner || '—') : '', d.type !== '新房' && d.owner_name ? '房东：' + d.owner_name : '', d.customer_name ? '客户：' + d.customer_name : ''].filter(Boolean).join('　');
  const whoText = (d) => d.type === '合作' ? (d.client_agents.join('、') || '—') : [d.type !== '新房' && d.listing_agents.length ? '房源方：' + d.listing_agents.join('、') : '', d.client_agents.length ? '客户方：' + d.client_agents.join('、') : ''].filter(Boolean).join('　') || '还没选业务员';

  // ---------- 分账明细（编辑页和单张结算单共用） ----------
  const itemName = (i) => i.type + (i.bank ? `（${i.bank}）` : '') + (i.person ? `（${i.person}）` : '') + (i.memo ? `（${i.memo}）` : '') + (i.paid_by ? `（${i.paid_by}垫付）` : '');
  // 介绍费写介绍人名字；维护费写备注（例如请吃饭）
  const EXTRA_FIELD = { '房东介绍费': 'person', '客户介绍费': 'person', '房东维护费': 'memo', '客户维护费': 'memo' };
  const MULTI = ['客户维护费', '房东维护费'];
  const reimbHTML = (r) => r.reimbTotal ? `<div class="bd-group"><span class="bd-title">业务员垫付的钱（结算时还给 TA）</span>
        ${Object.entries(r.reimb).map(([n, v]) => `<span>${esc(n)}</span><span class="num">+${f(v)}</span>`).join('')}
        <span class="sub" style="grid-column:1/-1">这笔钱上面已经算在支出里扣掉了，所以结算时单独加给垫付的人。</span></div>` : '';
  // forStatement=true 时用于结算单：不显示店面拿多少
  function breakdownHTML(d, forStatement) {
    const r = C.calcDeal(d);
    const lines = (items, minus) => items.map((i) => `<span class="sub">${minus ? '减：' : ''}${esc(itemName(i))}</span><span class="num sub">${minus ? '-' : ''}${f(C.toFen(i.amount))}</span>`).join('');
    const retName = (x) => x.type + (x.bank ? `（${x.bank}）` : '');
    const block = (title, blk, side, agents, profitPart, pct, rets, plabel) => {
      if (!blk) return '';
      const parts = (rets.length ? `<span class="sub">${plabel || '佣金纯利润 ' + pct + '%'}</span><span class="num sub">${f(profitPart)}</span>` + rets.map((x) => `<span class="sub">加：${esc(retName(x))}（不扣 10%）</span><span class="num sub">${f(x.fen)}</span>`).join('') : '');
      const ppl = agents.length ? agents.map((n) => `<span>${esc(n)}</span><span class="num">${f(side.agents[n] || 0)}</span>`).join('') : '<span class="muted">还没选业务员</span><span></span>';
      return `<div class="bd-group"><span class="bd-title" style="grid-column:auto">${title}</span><b class="num" style="color:var(--accent)">${f(blk)}</b>
        ${parts}${forStatement ? '' : `<span>店面一半</span><span class="num">${f(side.store)}</span>`}
        <span class="sub" style="grid-column:1/-1">业务员一半 ${f(blk - side.store)}，${agents.length > 1 ? agents.length + ' 人平分' : '归这位业务员'}：</span>${ppl}</div>`;
    };
    return `<div class="bd">
      <div class="bd-group"><span class="bd-title">一、总账</span>
        ${lines(d.incomes)}<span>收入合计</span><span class="num">${f(r.income)}</span>
        ${lines(d.expenses, true)}<span>支出合计</span><span class="num">-${f(r.expense)}</span>
        ${r.isCoop ? `<span>减：合作中介拿一半${d.partner ? '（' + esc(d.partner) + '）' : ''}</span><span class="num">-${f(r.partnerCut)}</span>` : ''}
        <span class="bd-key">总账（${r.isCoop ? '我们这一半 − 支出' : '收入 − 支出'}）</span><span class="num bd-key">${f(r.net)}</span></div>
      <div class="bd-group"><span class="bd-title">二、纯利润</span>
        <span>总账</span><span class="num">${f(r.net)}</span>
        ${d.parent_id ? '<span class="sub" style="grid-column:1/-1">返点不扣店面维护</span>' : r.rate ? `<span>减：店面维护成本 ${r.rate}%</span><span class="num">-${f(r.maint)}</span>${r.otherIncome || r.expense ? `<span class="sub" style="grid-column:1/-1">只扣佣金部分：（佣金 ${f(r.commission)}${r.expense ? ' − 支出 ' + f(r.expense) : ''}）× ${r.rate}%${r.otherIncome ? '，返点等其他收入 ' + f(r.otherIncome) + ' 不扣' : ''}</span>` : ''}` : `<span class="sub" style="grid-column:1/-1">${r.isCoop ? '合作单不扣店面维护成本，总账就是纯利润' : '新房不扣店面维护成本，总账就是纯利润'}</span>`}
        <span class="bd-key">纯利润</span><span class="num bd-key">${f(r.rest)}</span>
        ${r.otherIncome && r.isCoop ? '<span class="sub" style="grid-column:1/-1">合作单的返点和其他收入不给合作中介、不扣 10%，和我们那一半佣金放在一起，店面一半、业务员一半</span>' : ''}${r.otherIncome && !r.isCoop ? `<span class="sub" style="grid-column:1/-1">佣金部分 ${f(r.profit)} 按${d.type === '新房' ? '客户方 100%' : '房源方 20%、客户方 80%'}分；返点不按比例，直接归一方：${d.type === '新房' ? '新房全部归客户方' : '银行、装修返点归客户方，垫资返点归房源方，其他收入看选的哪一方'}</span>` : ''}</div>
      ${r.isCoop ? block('三、店面和业务员分（合作单不分房源方、客户方）', r.clientBlock, r.client, d.client_agents, r.clientProfit, 100, r.returns.client, '佣金我们这一半 − 支出')
        : d.type === '新房' ? block('三、客户方（新房，没有房源方）', r.clientBlock, r.client, d.client_agents, r.clientProfit, 100, r.returns.client)
        : block('三、房源方', r.listingBlock, r.listing, d.listing_agents, r.listingProfit, 20, r.returns.listing) + block('四、客户方', r.clientBlock, r.client, d.client_agents, r.clientProfit, 80, r.returns.client)}
      ${reimbHTML(r)}
      ${forStatement ? '' : `<div class="bd-group bd-store"><span class="bd-title">这一单合计</span>
        <span class="bd-key" style="border:0;padding:0">店面</span><span class="num bd-key" style="border:0;padding:0">${f(r.store)}</span>
        ${r.reimbTotal ? `<span class="sub">业务员分成</span><span class="num sub">${f(r.net - r.store)}</span><span class="sub">加：还业务员垫付</span><span class="num sub">${f(r.reimbTotal)}</span>` : ''}
        <span class="bd-key">业务员</span><span class="num bd-key">${f(r.net - r.store + r.reimbTotal)}</span>
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

  // ---------- 打印 / 存 PDF / 存图片（结算单、店面收入、业务员业绩共用） ----------
  const exportButtons = () => window.NO_PRINT
    ? '<div class="notice small">这是网页预览版，不能打印或保存。正式版这里有“打印”“下载 PDF”“下载图片”三个按钮。</div>'
    : `<div class="export-bar"><button data-x="print">打印</button><button data-x="pdf">下载 PDF</button><button class="btn-primary" data-x="img">下载图片</button></div>`;
  function openAll(sheet) { sheet.querySelectorAll('details').forEach((x) => { x.open = true; }); }
  let h2cLoading = null;
  const loadH2C = () => window.html2canvas ? Promise.resolve() : (h2cLoading = h2cLoading || new Promise((ok, bad) => {
    const sc = document.createElement('script'); sc.src = 'vendor/html2canvas.min.js'; sc.onload = ok; sc.onerror = () => { h2cLoading = null; bad(new Error('加载失败，请检查网络')); }; document.head.appendChild(sc);
  }));
  let pdfLoading = null;
  const loadPDF = () => window.jspdf ? Promise.resolve() : (pdfLoading = pdfLoading || new Promise((ok, bad) => {
    const sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js'; sc.onload = ok; sc.onerror = () => { pdfLoading = null; bad(new Error('加载失败，请检查网络')); }; document.head.appendChild(sc);
  }));
  const MOBILE = /Android|iPhone|iPad/.test(navigator.userAgent), WECHAT = /MicroMessenger/i.test(navigator.userAgent);
  const fileName = (name, ext) => `${name || '结算单'}.${ext}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  // 把结算单拍成一张大图；同时记下可以分页的位置（每一块的底部），PDF 分页时不会把一行字切开
  async function capture(sheet) {
    await loadH2C(); openAll(sheet);
    const card = sheet.querySelector('.wrap > .card:not(.no-print)');
    sheet.classList.add('capturing'); await new Promise((r) => setTimeout(r, 50));
    try {
      const canvas = await window.html2canvas(card, { windowWidth: 820, scale: 2, backgroundColor: '#ffffff', ignoreElements: (el) => el.classList && (el.classList.contains('no-print') || el.classList.contains('dd-hint')) });
      const top = card.getBoundingClientRect().top, k = canvas.height / card.getBoundingClientRect().height;
      const breaks = [...card.querySelectorAll('.bd-group, tr, h1, h2, h3, .kv > *, .notice, details, .small, .tiles, .deal-line')]
        .filter((el) => !el.closest('.no-print')).map((el) => Math.round((el.getBoundingClientRect().bottom - top) * k)).filter((y) => y > 0).sort((a, b) => a - b);
      return { canvas, breaks };
    } finally { sheet.classList.remove('capturing'); }
  }
  function download(blob, fname) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
  }
  // 手机上：先生成好，再弹一个框让人点按钮。
  // 很多安卓自带浏览器不认网页里生成的临时文件（blob），点了没反应。
  // 所以线上版会先把文件传到云端，拿到一个真正的下载链接，点“保存到手机”就像下载普通文件一样。
  function offer(blob, fname, title, imgUrl) {
    const file = new File([blob], fname, { type: blob.type });
    const canShare = !WECHAT && !!navigator.canShare && navigator.canShare({ files: [file] });
    const isImg = blob.type.startsWith('image/');
    const ov = document.createElement('div'); ov.className = 'img-ov';
    const tip = WECHAT ? (isImg ? '<b>长按下面的图片</b>，选“保存图片”或“发送给朋友”。' : '')
      : isImg ? '点“保存到手机”，或者长按图片保存。' : `${esc(fname)} 已经生成好了，点“保存到手机”。`;
    ov.innerHTML = `<div class="img-box"><div style="font-size:17px">${tip}</div>
      ${isImg ? `<img src="${imgUrl}" alt="${esc(title)}">` : ''}
      <div class="small muted" data-st aria-live="polite"></div>
      ${WECHAT ? '' : `${canShare ? `<button class="btn-primary btn-block" data-share style="font-size:19px;min-height:52px">发到微信</button><div class="small muted">点了会弹出分享，选“微信”，再选要发的群或人。${isImg ? '发出去就是这张图片' : '发出去就是这个 PDF 文件'}，不用先保存。</div>` : ''}
      <div class="row" style="gap:8px"><a class="btn ${canShare ? '' : 'btn-primary '}grow" data-save href="#" role="button">保存到手机</a></div>`}
      <div class="row" style="gap:8px"><button class="grow" data-copy hidden>复制下载链接</button><button class="grow" data-close>关闭</button></div></div>`;
    const st = (m) => { ov.querySelector('[data-st]').textContent = m; };
    ov.querySelector('[data-close]').onclick = () => ov.remove();
    document.body.appendChild(ov);
    if (WECHAT) return;
    const sv = ov.querySelector('[data-save]'), cp = ov.querySelector('[data-copy]');
    let link = null;
    // 线上：先传到云端（大约 1~3 秒）；演示模式没有云端，用老办法
    if (S.uploadExport) {
      sv.classList.add('disabled'); sv.textContent = '正在准备…';
      S.uploadExport(blob, fname).then((u) => {
        link = u.download; sv.href = link; sv.setAttribute('download', fname); sv.classList.remove('disabled'); sv.textContent = '保存到手机'; cp.hidden = false;
      }).catch(() => { sv.classList.remove('disabled'); sv.textContent = '保存到手机'; st('网络不好，没准备好下载链接，先试试直接保存。'); });
    }
    sv.onclick = (e) => {
      if (sv.classList.contains('disabled')) { e.preventDefault(); return; }
      if (link) { st('已经开始下载，看手机顶部的下载提示，或者到“文件管理 → 下载”里找。没反应就点“复制下载链接”，粘贴到浏览器打开。'); return; } // 让浏览器按普通链接下载
      e.preventDefault(); download(blob, fname); st('已保存到手机的“下载”文件夹。没反应的话请长按图片保存，或者换个浏览器。');
    };
    cp.onclick = () => link && copy(link);
    const sh = ov.querySelector('[data-share]');
    // 只发文件、不带文字：带了文字的话，微信有时只收到文字、收不到图片
    if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') st('这个手机不能直接发，请点“保存到手机”，再到微信里发。'); } };
  }
  function busy(btn, fn) {
    return async () => { const old = btn.textContent; btn.textContent = '正在生成…'; btn.disabled = true;
      try { await fn(); } catch (e) { toast(e.message || '生成失败'); } finally { btn.textContent = old; btn.disabled = false; } };
  }
  function bindExport(sheet, name) {
    const b = (x) => sheet.querySelector(`[data-x=${x}]`);
    if (!b('print')) return;
    b('print').onclick = () => { openAll(sheet); window.print(); };
    b('pdf').onclick = busy(b('pdf'), async () => {
      if (WECHAT) return toast('微信里不能下载 PDF，请点“下载图片”，或者右上角“···”选“在浏览器打开”');
      const [{ canvas, breaks }] = await Promise.all([capture(sheet), loadPDF()]);
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const M = 10, W = 210 - 2 * M, H = 297 - 2 * M;           // 页边距 10mm
      const pageH = Math.floor(canvas.width * H / W);            // 一页能放多高（像素）
      let y = 0, first = true;
      while (y < canvas.height - 2) {
        let end = Math.min(y + pageH, canvas.height);
        if (end < canvas.height) { const ok = breaks.filter((v) => v > y + pageH * 0.5 && v <= end); if (ok.length) end = ok[ok.length - 1]; }
        const part = document.createElement('canvas'); part.width = canvas.width; part.height = end - y;
        part.getContext('2d').drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
        if (!first) pdf.addPage(); first = false;
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, W, (end - y) * W / canvas.width);
        y = end;
      }
      const blob = pdf.output('blob'), fname = fileName(name, 'pdf');
      if (MOBILE) offer(blob, fname, name); else { download(blob, fname); toast('PDF 已下载'); }
    });
    b('img').onclick = busy(b('img'), async () => {
      const { canvas } = await capture(sheet);
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
      const fname = fileName(name, 'png');
      if (MOBILE) offer(blob, fname, name, canvas.toDataURL('image/png')); else { download(blob, fname); toast('图片已下载'); }
    });
  }

  // ---------- 外框 ----------
  function shell(inner, extra = '') {
    const demo = S.mode === 'demo' ? '<span class="badge-demo">演示数据</span>' : '';
    app.innerHTML = `
      <div class="wrap" id="main">
        <div class="topbar"><h1>文城房产 · 店面记账</h1>${demo}</div>
        <div id="view" class="stack">${inner}</div>
      </div>${extra}
      <nav class="tabbar" aria-label="主菜单">
        <button data-tab="listings" aria-current="${state.tab === 'listings'}">房源</button>
        <button data-tab="deals" aria-current="${state.tab === 'deals'}">记账</button>
        <button data-tab="settle" aria-current="${state.tab === 'settle'}">结算</button>
        <button data-tab="agents" aria-current="${state.tab === 'agents'}">业务员</button>
        <button data-tab="todo" aria-current="${state.tab === 'todo'}">待办${(() => { const n = todoCount(); return n ? ` <span class="todo-n">${n}</span>` : ''; })()}</button>
      </nav>`;
    app.querySelectorAll('.tabbar button').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; render(); });
  }
  function render() {
    if (state.tab === 'deals') return renderDeals();
    if (state.tab === 'settle') return renderSettle();
    if (state.tab === 'listings') return renderListings();
    if (state.tab === 'todo') return renderTodo();
    return renderAgents();
  }
  async function reload() { await loadAll(); render(); }


  // ---------- 待办（后台监视）：还有哪些事没做完、卡在谁那里 ----------
  const DAY = 86400000;
  const daysAgo = (t) => t ? Math.floor((Date.now() - new Date(t).getTime()) / DAY) : null;
  const phoneOK = (p) => (p || '').replace(/\D/g, '').length >= 7;
  function todoData() {
    const active = state.agents.filter((a) => a.active);
    const auto = new Set(state.agents.filter((a) => a.auto_confirm).map((a) => a.name));
    const confirming = state.deals.filter((d) => d.status === 'confirming');
    // 1. 谁还没确认
    const unconf = {};
    confirming.forEach((d) => { const p = progress(d); p.who.filter((n) => !(p.cm[n] && p.cm[n].status === 'ok') && !auto.has(n)).forEach((n) => (unconf[n] = unconf[n] || []).push(d)); });
    // 2. 客户信息没填（补记的返点不用填）
    const noCust = state.deals.filter((d) => d.status !== 'draft' && !d.parent_id && (d.client_agents || []).length && (!(d.customer_name || '').trim() || !phoneOK(d.customer_phone)));
    const live = state.listings.filter((l) => l.status !== 'off');
    // 3. 房源待补全
    const needInfo = live.filter((l) => l.needs_info);
    // 4. 在售 / 在租的房源，30 天没人跟进（没改过、没写反馈、没改备注）
    const lastTouch = (l) => [l.updated_at, l.note_at, l.created_at, ...(l.feedback || []).map((x) => x.created_at)].filter(Boolean).sort().pop();
    const stale = live.filter((l) => l.status === 'active' && daysAgo(lastTouch(l)) >= 30).map((l) => ({ l, days: daysAgo(lastTouch(l)) })).sort((x, y) => y.days - x.days);
    // 5. 房东电话没留
    const noOwner = live.filter((l) => l.status === 'active' && (!(l.owners || []).length || (l.owners || []).some((o) => !phoneOK(o.phone))));
    // 6. 业务员这边的问题：没设密码、还没登记手机、输错锁住了
    const people = active.filter((a) => !a.auto_confirm);
    const noPw = people.filter((a) => !a.phone4), locked = people.filter((a) => (a.fail_count || 0) >= 5), unbound = people.filter((a) => a.phone4 && !a.device_token && (a.fail_count || 0) < 5);
    // 7. 草稿没发出去；8. 已确认等结算
    const drafts = state.deals.filter((d) => d.status === 'draft');
    const toSettle = state.deals.filter(canSettle).sort((x, y) => x.deal_date.localeCompare(y.deal_date));
    // 按人汇总（催办用）：每个人还有几件事没做
    const per = {};
    const add = (n, k) => { if (!active.some((a) => a.name === n) || auto.has(n)) return; (per[n] = per[n] || { confirm: 0, cust: 0, fill: 0, stale: 0, owner: 0 })[k]++; };
    Object.entries(unconf).forEach(([n, ds]) => ds.forEach(() => add(n, 'confirm')));
    noCust.forEach((d) => { const ok = state.confs.filter((c) => c.deal_id === d.id && c.status === 'ok').map((c) => c.agent_name);
      // 还没确认的客户方会在确认时填，这里只算已经确认过、但客户信息还空着的旧单子；没人确认过的算在“确认”里
      d.client_agents.filter((n) => ok.includes(n)).forEach((n) => add(n, 'cust')); });
    needInfo.forEach((l) => (l.agents || []).forEach((n) => add(n, 'fill')));
    stale.forEach(({ l }) => (l.agents || []).forEach((n) => add(n, 'stale')));
    noOwner.filter((l) => !l.needs_info).forEach((l) => (l.agents || []).forEach((n) => add(n, 'owner')));
    return { unconf, confirming, noCust, needInfo, stale, noOwner, noPw, locked, unbound, drafts, toSettle, per };
  }
  function todoCount() {
    try { const t = todoData(); return t.confirming.length + t.noCust.length + t.needInfo.length + t.drafts.length + t.locked.length; } catch (e) { return 0; }
  }
  function renderTodo() {
    const t = todoData();
    const byPerson = (list, who) => { const m = {}; list.forEach((x) => who(x).forEach((n) => (m[n] = m[n] || []).push(x))); return sortNames(Object.keys(m)).map((n) => [n, m[n]]); };
    const dealBtn = (d, extra) => `<button class="deal-line" data-d="${d.id}"><div class="row" style="gap:8px;flex-wrap:nowrap">${typeTag(d.type)}<b class="grow">${esc(d.title || '（没写房子）')}</b><span class="muted">›</span></div><div class="small muted"><span class="num">${d.deal_date}</span>${extra ? '　' + extra : ''}</div></button>`;
    const lTitle = (l) => `${esc(l.community || '')} ${esc(l.unit || '')}`.trim() || '（没写坐落）';
    const lBtn = (l, extra) => `<button class="deal-line" data-l="${l.id}"><div class="row" style="gap:8px;flex-wrap:nowrap"><b class="grow">${lTitle(l)}</b><span class="muted">›</span></div><div class="small muted">${esc(l.kind || '')}　维护人：${esc((l.agents || []).join('、') || '—')}${extra ? '　' + extra : ''}</div></button>`;
    const nameBtn = (n, txt) => `<button class="deal-line" data-a="${esc(n)}"><div class="row" style="gap:8px;flex-wrap:nowrap"><b class="grow">${esc(n)}</b><span>${txt}</span><span class="muted">›</span></div></button>`;
    const sec = (title, n, hint, body, ok) => `<details class="card todo-sec" ${n ? 'open' : ''}><summary class="row between"><b>${title}</b>${n ? `<span class="todo-n">${n}</span>` : '<span class="pill ok">都好了</span>'}</summary>
      ${n ? `<div class="small muted" style="margin:6px 0">${hint}</div>${body}` : `<div class="small muted" style="margin-top:6px">${ok}</div>`}</details>`;
    const unconfRows = sortNames(Object.keys(t.unconf)).map((n) => { const ds = t.unconf[n]; const old = Math.max(...ds.map((d) => daysAgo(d.updated_at || d.created_at) || 0)); return nameBtn(n, `<b class="num">${ds.length}</b> 单没确认${old >= 2 ? `<span class="small muted">（最久等了 ${old} 天）</span>` : ''}`); }).join('');
    const custRows = byPerson(t.noCust, (d) => d.client_agents).map(([n, ds]) => `<div class="small" style="margin-top:8px"><b>${esc(n)}</b>（${ds.length} 单）</div>${ds.map((d) => dealBtn(d, d.customer_name ? '缺电话' : '名字、电话都没填')).join('')}`).join('');
    const needRows = byPerson(t.needInfo, (l) => l.agents && l.agents.length ? l.agents : ['（没有维护人）']).map(([n, ls]) => `<div class="small" style="margin-top:8px"><b>${esc(n)}</b>（${ls.length} 套）</div>${ls.map((l) => lBtn(l, '户型面积还没填')).join('')}`).join('');
    const staleRows = t.stale.slice(0, 30).map(({ l, days }) => lBtn(l, `${days} 天没动静`)).join('') + (t.stale.length > 30 ? `<div class="small muted">还有 ${t.stale.length - 30} 套没列出来</div>` : '');
    const ownerRows = t.noOwner.slice(0, 30).map((l) => lBtn(l, (l.owners || []).length ? '有房东没留电话' : '没填房东')).join('') + (t.noOwner.length > 30 ? `<div class="small muted">还有 ${t.noOwner.length - 30} 套没列出来</div>` : '');
    const agentProblems = [...t.locked.map((a) => nameBtn(a.name, '<span class="pill seal">密码输错太多次，锁住了</span>')), ...t.noPw.map((a) => nameBtn(a.name, '还没设个人密码')), ...t.unbound.map((a) => nameBtn(a.name, '还没在手机上登记过'))].join('');
    const settleSum = t.toSettle.reduce((s, d) => s + C.calcDeal(d).net, 0);
    const LBL = { confirm: '单没确认', cust: '单缺客户电话', fill: '套房源要补资料', owner: '套没留房东电话', stale: '套房源 30 天没跟进' };
    const perNames = sortNames(Object.keys(t.per));
    const lastNudge = (n) => (state.nudges || []).find((x) => x.agent_name === n);
    const hasPush = (n) => (state.pushSubs || []).some((x) => x.agent_name === n);
    const nudgeTxt = (n) => { const x = lastNudge(n); if (!x) return ''; const d = new Date(x.created_at), p = (v) => String(v).padStart(2, '0');
      return `<span class="small muted">${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())} 催过，${x.seen_at ? '她已经看到了' : '她还没打开看'}</span>`; };
    const nudgeRows = perNames.map((n) => `<div class="nudge-row"><div class="grow"><button class="linkish" data-a="${esc(n)}"><b>${esc(n)}</b></button>${hasPush(n) ? ' <span class="small muted">🔔 锁屏能收到</span>' : ''}
        <div class="small">${Object.entries(t.per[n]).filter(([, v]) => v).map(([k, v]) => `<b class="num">${v}</b> ${LBL[k]}`).join('，')}</div>${nudgeTxt(n)}</div>
        </div>`).join('');
    shell(`
      <div class="card stack" style="gap:6px"><h2 style="margin:0">待办</h2><div class="small muted">哪些事还没做完、卡在谁那里，一页看清。点名字或单子直接打开。</div></div>
      ${perNames.length ? `<div class="stack" style="gap:4px"><button class="btn-primary btn-block" id="nudge-all" style="font-size:19px;min-height:54px">🔔 一起催办（${perNames.length} 人）</button><div class="small muted">点了会同时复制一段催办消息，写着每个人还差什么。到微信群里长按“粘贴”发出去，大家手机锁屏都能看到。</div></div>` : ''}
      ${sec('按人看', perNames.length, '每个人还有几件事没做。点上面“一起催办”：开了锁屏提醒的（🔔）手机锁屏马上收到；没开的下次打开业务员页会弹出提醒。', nudgeRows, '大家手上都没有没做完的事。')}
      ${sec('等业务员确认', t.confirming.length, `${t.confirming.length} 单还在等确认。下面是每个人还有几单没点确认，可以在群里提醒一下。`, unconfRows, '所有发出去的单子都确认完了。')}
      ${sec('客户信息没填', t.noCust.length, '客户方业务员确认时会填。下面按客户方业务员列出来，同一单有几个人的话谁填都行。', custRows, '每一单的客户名字、电话都有了。')}
      ${sec('房源待补全', t.needInfo.length, '记账时自动建的房源，只有小区和坐落，等房源维护人补户型、面积。', needRows, '没有要补全的房源。')}
      ${sec('业务员还不能确认', t.locked.length + t.noPw.length + t.unbound.length, '没设密码的要在“业务员”里设一个；锁住的点进去解锁；没登记过的，把业务员链接发给她，让她点自己名字登记一次。', agentProblems, '每个业务员都能正常确认。')}
      ${sec('草稿没发出去', t.drafts.length, '记了但还没发给业务员确认的单子。', t.drafts.map((d) => dealBtn(d, '草稿')).join(''), '没有草稿。')}
      ${sec('在售在租，30 天没人跟进', t.stale.length, '30 天里没改过、没写备注、没写联系反馈。可以问一下维护人房子还在不在卖。', staleRows, '在售在租的房源最近都有人跟。')}
      ${sec('房东电话没留', t.noOwner.length, '在售在租的房源里，没填房东或者房东没留电话的。', ownerRows, '房东电话都有。')}
      ${sec('已确认、等结算', t.toSettle.length, `一共 ${t.toSettle.length} 单，总账 ${f(settleSum)}。最早一单是 ${t.toSettle[0] ? t.toSettle[0].deal_date : ''}。`, '<button class="btn-primary btn-block" id="go-settle" style="margin-top:6px">去结算</button>', '没有等结算的单子。')}
    `);
    app.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => openDeal(state.deals.find((d) => String(d.id) === b.dataset.d)));
    app.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => openListing(state.listings.find((l) => String(l.id) === b.dataset.l)));
    app.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => openAgent(b.dataset.a));
    if ($('#go-settle')) $('#go-settle').onclick = () => { state.tab = 'settle'; render(); };
    const bodyOf = (n) => '您还有 ' + Object.entries(t.per[n]).filter(([, v]) => v).map(([k, v]) => v + ' ' + LBL[k]).join('，') + '。点开处理一下。';
    const doNudge = async (names, btn) => {
      btn.disabled = true; btn.textContent = '正在发…';
      try { await run(() => S.nudge(names)); } catch (e) { btn.disabled = false; btn.textContent = '再试一次'; return; }
      let pushed = null;
      if (S.pushNudge && (window.APP_CONFIG || {}).pushPublicKey) { try { pushed = await S.pushNudge(names.map((n) => ({ name: n, body: bodyOf(n) }))); } catch (e) { pushed = null; } }
      await loadAll(); renderTodo();
      toast(`已经催了 ${names.length} 个人，催办消息也复制好了，去微信群里粘贴发出去` + (pushed && pushed.sent ? `（${pushed.sent} 人 iPhone 锁屏已收到）` : ''));
    };
    // 一起催办：同时复制一段催办消息，到微信群里粘贴（安卓手机锁屏靠微信消息提醒）
    const groupMsg = () => '【店面提醒】\n' + perNames.map((n) => `@${n} 还有 ` + Object.entries(t.per[n]).filter(([, v]) => v).map(([k, v]) => v + ' ' + LBL[k]).join('，')).join('\n') + `\n请打开业务员页处理一下：${CONFIRM_URL()}`;
    if ($('#nudge-all')) $('#nudge-all').onclick = (e) => { copy(groupMsg()); doNudge(perNames, e.currentTarget); };
  }

  // ---------- 记账 ----------
  // 记账页检索：房子、房东、客户、业务员、备注、日期、类型都能搜，多个词用空格隔开
  const dealStat = (d) => d.settlement_id ? 'settled' : d.status === 'draft' ? 'confirming' : d.status;
  const dealFields = (d) => [d.title, d.owner_name, d.customer_name, d.partner, d.note, d.deal_date, d.type, ...(d.listing_agents || []), ...(d.client_agents || []),
    ...(d.incomes || []).map((i) => i.type + (i.bank || '')), ...(d.expenses || []).map((i) => [i.person, i.memo, i.paid_by].filter(Boolean).join(' '))];
  function renderDeals() {
    const months = [...new Set(state.deals.map((d) => d.deal_date.slice(0, 7)))].sort().reverse();
    shell(`
      <div class="row">
        <select id="month" class="grow" aria-label="月份"><option value="">全部月份</option>${months.map((m) => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <button class="btn-primary" id="add">＋ 记一单</button>
      </div>
      <div class="card stack" style="gap:8px">
        <input id="dq" type="search" value="${esc(state.dq)}" placeholder="搜房子、房东、客户、业务员…" aria-label="搜索记账" autocomplete="off">
        <div class="seg" role="group" aria-label="状态" style="grid-template-columns:repeat(4,1fr)">${[['', '全部'], ['confirming', '等确认'], ['locked', '已确认'], ['settled', '已结算']].map(([v, t]) => `<button type="button" data-dstat="${v}" aria-pressed="${state.dstat === v}">${t}</button>`).join('')}</div>
      </div>
      <div id="deal-results"></div>`);
    $('#month').onchange = (e) => { state.month = e.target.value; drawDeals(); };
    $('#add').onclick = () => openDeal(null);
    const dq = $('#dq');
    dq.addEventListener('input', (e) => { if (e.isComposing) return; state.dq = dq.value; drawDeals(); });
    dq.addEventListener('compositionend', () => { state.dq = dq.value; drawDeals(); });
    app.querySelectorAll('[data-dstat]').forEach((b) => b.onclick = () => { state.dstat = b.dataset.dstat; app.querySelectorAll('[data-dstat]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawDeals(); });
    drawDeals();
  }
  function drawDeals() {
    const words = state.dq.trim();
    const list = state.deals.filter((d) => (!state.month || d.deal_date.startsWith(state.month))
      && (!state.dstat || dealStat(d) === state.dstat)
      && C.fuzzy(dealFields(d), state.dq));
    let inc = 0, net = 0; list.forEach((d) => { const r = C.calcDeal(d); inc += r.income; net += r.net; });
    const cards = list.map((d) => {
      const r = C.calcDeal(d);
      const warn = r.warnings.length ? '<span class="pill warn">要检查</span>' : '';
      return `<button class="card with-badge" data-id="${d.id}">${typeTag(d.type, true)}<div class="stack grow" style="gap:4px">
        <div class="row" style="gap:10px"><b class="grow" style="font-size:18px">${esc(d.title || '（没写房子）')}</b>${warn}</div>
        <div class="muted small num">${d.deal_date}${d.deal_price != null ? `　成交价 ${d.type === '租房' ? Number(d.deal_price).toLocaleString() + ' 元/月' : Number(d.deal_price).toLocaleString() + ' 万'}` : ''}</div>
        <div class="row between small"><span class="muted">收入 <span class="num">${f(r.income)}</span>　支出 <span class="num">${f(r.expense)}</span></span><span>总账 <b class="num">${f(r.net)}</b></span></div>
        ${partyText(d) ? `<div class="small muted">${esc(partyText(d))}</div>` : ''}
        <div class="small muted">业务员　${esc(whoText(d))}</div>
        ${steps(d)}
      </div></button>`;
    }).join('');
    const filtering = words.length || state.dstat;
    const box = $('#deal-results'); box.className = 'stack';
    box.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="small muted">单数</div><div class="v num">${list.length}</div></div>
        <div class="tile"><div class="small muted">收入合计</div><div class="v num">${f(inc)}</div></div>
        <div class="tile"><div class="small muted">总账合计</div><div class="v num">${f(net)}</div></div>
      </div>
      ${cards || `<div class="card muted">${filtering ? '没有找到，换个词试试，或者点“全部”。' : '还没有记账。点“记一单”开始。'}</div>`}`;
    box.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => openDeal(state.deals.find((d) => String(d.id) === b.dataset.id)));
  }

  function openSheet(html, label) {
    const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', label);
    sheet.innerHTML = html; document.body.appendChild(sheet); return sheet;
  }

  // 补记晚到的返点：单独记一笔挂在原单下面。原单不动、不用重新确认，只有分这笔钱的业务员确认这一小笔
  const ADDON_TYPES = ['银行返点', '装修返点', '垫资返点', '其他收入'];
  function openAddon(parent, addon) {
    const locked = addon && addon.status === 'locked';
    const dis = locked ? 'disabled' : '';
    const one = C.oneSide(parent.type);
    const its = addon ? addon.incomes : [];
    const sideName = (side) => side === 'listing' ? `房源方（${(parent.listing_agents || []).join('、') || '没选人'}）` : `${one ? '' : '客户方'}（${(parent.client_agents || []).join('、') || '没选人'}）`;
    const row = (t) => { const it = its.find((x) => x.type === t);
      const side = t === '其他收入' ? (it && it.side) || 'client' : C.RETURN_SIDE[t];
      return `<div class="money-row"><label><input type="checkbox" data-at="${t}" ${it ? 'checked' : ''} ${dis}>${t}</label>
        <input type="text" class="amt" inputmode="decimal" autocomplete="off" data-aa="${t}" value="${it ? it.amount : ''}" placeholder="0" ${dis} aria-label="${t}金额">
        ${t === '银行返点' ? `<input class="bank" data-ab value="${esc(it && it.bank || '')}" placeholder="哪家银行，例如：农行" ${dis} aria-label="哪家银行" style="grid-column:1/-1">` : ''}
        ${t === '其他收入' && !one ? `<select class="paid" data-aside ${dis} aria-label="其他收入跟谁分" style="grid-column:1/-1"><option value="client" ${side === 'client' ? 'selected' : ''}>跟客户方分</option><option value="listing" ${side === 'listing' ? 'selected' : ''}>跟房源方分</option></select>`
          : `<div class="small muted" style="grid-column:1/-1">归${one ? '这一单的业务员' : ''}${sideName(one ? 'client' : side)}</div>`}</div>`; };
    const p = addon ? progress(addon) : null;
    const sheet = openSheet(`<div class="wrap stack">
        <div class="row between"><h2>${addon ? '补记的返点' : '补记晚到的返点'}</h2>${typeTag(parent.type)}</div>
        <div class="notice">原单：${esc(parent.deal_date)}　${esc(parent.title || '')}<br><span class="small">原单不动，也不用重新确认。这一笔单独算，只有分这笔钱的业务员确认一下。</span></div>
        ${addon ? steps(addon) : ''}
        ${addon ? '<button class="btn-primary btn-block" id="a-stmt">这一笔的结算单（发到群里）</button>' : ''}
        ${addon && addon.status !== 'draft' ? `<div class="card stack" style="gap:6px"><h3>业务员确认情况</h3>${p.who.map((n) => { const c = p.cm[n]; return `<div class="row between"><span>${esc(n)}</span>${c && c.status === 'ok' ? '<span class="pill ok">已确认</span>' : '<span class="pill gray">还没确认</span>'}</div>`; }).join('')}</div>` : ''}
        ${locked ? '<div class="notice">相关业务员都确认了，这一笔已锁定。</div>' : ''}
        <div class="card stack">
          <label class="field">到账日期<input type="date" id="a-date" value="${addon ? addon.deal_date : today()}" ${dis}></label>
          <div class="stack" style="gap:8px">${ADDON_TYPES.map(row).join('')}</div>
          <label class="field">备注<input id="a-note" value="${esc(addon ? addon.note || '' : '')}" placeholder="例如：农行返点 11 月到账" ${dis}></label>
        </div>
        <div id="a-prev"></div>
      </div>
      <div class="sheet-actions">
        <button id="a-cancel">${locked ? '返回' : '取消'}</button>
        ${addon && !locked ? '<button id="a-del" class="btn-danger">删除</button>' : ''}
        ${locked ? '' : `<button id="a-save" class="btn-primary">${addon ? '保存' : '保存，发给业务员确认'}</button>`}
      </div>`, '补记返点');
    const close = () => sheet.remove();
    const collect = () => {
      const incomes = ADDON_TYPES.filter((t) => $(`[data-at="${t}"]`, sheet).checked).map((t) => {
        const it = { type: t, amount: Number($(`[data-aa="${t}"]`, sheet).value.replace(/[^\d.]/g, '') || 0) };
        if (t === '银行返点') { const b = $('[data-ab]', sheet).value.trim(); if (b) it.bank = b; }
        if (t === '其他收入' && !one) it.side = $('[data-aside]', sheet).value;
        return it; });
      const sides = new Set(incomes.map((i) => C.sideOf(i, one)));
      return { ...(addon || {}), parent_id: parent.id, type: parent.type, title: '补记返点 · ' + (parent.title || ''), owner_name: parent.owner_name || '', partner: parent.partner || '',
        customer_name: parent.customer_name || '', customer_phone: parent.customer_phone || '', listing_id: null, expenses: [],
        incomes, deal_date: $('#a-date', sheet).value, note: $('#a-note', sheet).value.trim(),
        listing_agents: !one && sides.has('listing') ? (parent.listing_agents || []).slice() : [], client_agents: sides.has('client') ? (parent.client_agents || []).slice() : [] };
    };
    const preview = () => {
      if (locked) return;
      const d = collect(); const r = C.calcDeal(d);
      $('#a-prev', sheet).innerHTML = d.incomes.length ? `<div class="card stack" style="gap:4px"><h3>这一笔怎么分</h3>
        ${Object.entries(r.share).map(([n, v]) => `<div class="row between"><span>${esc(n)}</span><b class="num">${f(v)}</b></div>`).join('')}
        <div class="row between muted"><span>店面</span><span class="num">${f(r.store)}</span></div></div>` : '';
    };
    sheet.querySelectorAll('[data-at]').forEach((c) => c.onchange = () => { if (c.checked) $(`[data-aa="${c.dataset.at}"]`, sheet).focus(); preview(); });
    sheet.querySelectorAll('[data-aa]').forEach((i) => i.oninput = () => { if (i.value) $(`[data-at="${i.dataset.aa}"]`, sheet).checked = true; preview(); });
    if ($('[data-aside]', sheet)) $('[data-aside]', sheet).onchange = preview;
    preview();
    $('#a-cancel', sheet).onclick = close;
    if ($('#a-stmt', sheet)) $('#a-stmt', sheet).onclick = () => openStatement({ title: '单笔结算单', sub: `${addon.deal_date}　${addon.title || ''}`, deals: [addon] });
    if ($('#a-del', sheet)) twice($('#a-del', sheet), '再点一次删除', async () => { await run(() => S.deleteDeal(addon.id)); close(); toast('已删除'); await reload(); });
    if ($('#a-save', sheet)) $('#a-save', sheet).onclick = async () => {
      const d = collect();
      if (!d.deal_date) return toast('请选到账日期');
      if (!d.incomes.length || d.incomes.some((i) => !i.amount)) return toast('请勾选到账的返点，并填上金额');
      if (!d.listing_agents.length && !d.client_agents.length) return toast('原单没有选这一方的业务员，没法分');
      await run(() => S.saveDeal(d, true)); close(); toast('已保存，打开这一笔可以生成结算单发到群里'); await reload();
    };
  }

  function openDeal(deal, prefill) {
    if (deal && deal.parent_id) { const par = state.deals.find((x) => x.id === deal.parent_id); if (par) return openAddon(par, deal); }
    const d = deal ? JSON.parse(JSON.stringify(deal)) : { deal_date: today(), type: '二手买卖', title: '', owner_name: '', customer_name: '', incomes: [], expenses: [], listing_agents: [], client_agents: [], note: '', ...(prefill || {}) };
    const locked = deal && deal.status === 'locked';
    const p = deal ? progress(deal) : null;
    const names = state.agents.filter((a) => a.active || d.listing_agents.includes(a.name) || d.client_agents.includes(a.name)).map((a) => a.name);
    const dis = locked ? 'disabled' : '';
    // 维护费可以有好几个人垫钱：一行一个人（垫付人 + 备注 + 金额），点“＋”再加一行
    const payOpts = (sel) => `<option value="">周姐</option>${names.concat(sel && !names.includes(sel) ? [sel] : []).map((n) => `<option value="${esc(n)}" ${sel === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    const mline = (t, it, on) => `<div class="mline" data-m="${t}">
        <select class="paid" data-mpaid ${on ? '' : 'disabled'} aria-label="谁垫付的">${payOpts(it && it.paid_by)}</select>
        <input class="person" data-mmemo value="${esc(it ? it.memo || it.person || '' : '')}" placeholder="备注" ${on ? '' : 'disabled'} aria-label="备注">
        <input type="text" class="amt" data-mamt inputmode="decimal" autocomplete="off" value="${it ? it.amount : ''}" placeholder="0" ${on ? '' : 'disabled'} aria-label="金额">
        <button type="button" class="mdel" ${on ? '' : 'disabled'} aria-label="删掉这一行">×</button></div>`;
    const multiRow = (t) => {
      const its = d.expenses.filter((x) => x.type === t), on = its.length > 0 && !locked;
      return `<div class="money-row multi"><label><input type="checkbox" data-kind="expenses" data-t="${t}" data-multi="1" ${its.length ? 'checked' : ''} ${dis}>${t}</label>
        <div class="mlines" data-ml="${t}" ${its.length ? '' : 'hidden'}><div class="mline mhead small muted"><span>谁垫的钱</span><span>备注</span><span style="text-align:right">金额</span><span></span></div>${(its.length ? its : [null]).map((it) => mline(t, it, on)).join('')}
        <button type="button" class="madd" data-madd="${t}" ${on ? '' : 'disabled'}>＋ 再加一个人</button></div></div>`;
    };
    const moneyRows = (kind, types) => types.map((t) => {
      if (kind === 'expenses' && MULTI.includes(t)) return multiRow(t);
      const it = d[kind].find((x) => x.type === t);
      const bank = t === '银行返点' ? `<input class="bank" data-bank="1" value="${esc(it && it.bank || '')}" placeholder="哪家银行，例如：农行" ${it && !locked ? '' : 'disabled'} aria-label="哪家银行" style="grid-column:1/-1">`
        : t === '其他收入' && kind === 'incomes' && !C.oneSide(d.type) ? `<select class="paid" data-side="1" ${it && !locked ? '' : 'disabled'} aria-label="其他收入跟谁分" style="grid-column:1/-1">
            <option value="client" ${it && it.side === 'listing' ? '' : 'selected'}>跟客户方分</option><option value="listing" ${it && it.side === 'listing' ? 'selected' : ''}>跟房源方分</option></select>` : '';
      const ex = kind === 'expenses' && EXTRA_FIELD[t];
      // 以前的数据维护费也写在介绍人里，这里当备注显示
      const xv = ex === 'person' ? (it && it.person) || '' : ex === 'memo' ? (it && (it.memo || it.person)) || '' : '';
      const extra = ex ? `<input class="person" data-x2="${t}" value="${esc(xv)}" placeholder="${ex === 'person' ? '介绍人名字' : '备注'}" ${it && !locked ? '' : 'disabled'} aria-label="${t}的${ex === 'person' ? '介绍人' : '备注'}">` : '';
      const payers = names.concat(it && it.paid_by && !names.includes(it.paid_by) ? [it.paid_by] : []);
      const paid = kind === 'expenses' ? `<select class="paid" data-paid="${t}" ${it && !locked ? '' : 'disabled'} ${it ? '' : 'hidden'} aria-label="${t}是谁付的" style="grid-column:1/-1">
          <option value="">周姐</option>${payers.map((n) => `<option value="${esc(n)}" ${it && it.paid_by === n ? 'selected' : ''}>${esc(n)}垫付</option>`).join('')}</select>` : '';
      return `<div class="money-row${ex ? ' with-person' : ''}"><label><input type="checkbox" data-kind="${kind}" data-t="${t}" ${it ? 'checked' : ''} ${dis}>${t}</label>${extra}
        <input type="text" class="amt" inputmode="decimal" autocomplete="off" data-kind="${kind}" data-t="${t}" value="${it ? it.amount : ''}" placeholder="0" ${it && !locked ? '' : 'disabled'} aria-label="${t}金额">${bank}${paid}</div>`;
    }).join('');
    const chips = (field) => names.map((n) => `<button type="button" class="chip" data-f="${field}" data-n="${esc(n)}" aria-pressed="${d[field].includes(n)}" ${dis}>${esc(n)}</button>`).join('');
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="row between"><h2>${deal ? '这一单' : '记一单'}</h2>${deal ? typeTag(deal.type) : ''}</div>
        ${deal ? steps(deal) : ''}
        ${deal ? '<button class="btn-primary btn-block" id="s-stmt">这一单的结算单（发到群里）</button>' : ''}
        ${deal && deal.status !== 'draft' ? `<div class="card stack" style="gap:6px"><div class="row between"><b>晚到的返点</b><button id="s-addon">＋ 补记返点</button></div>
          ${state.deals.filter((x) => x.parent_id === deal.id).map((x) => `<button class="linkish" data-addon="${x.id}" style="text-align:left">${esc(x.deal_date)}　${x.incomes.map((i) => esc(i.type) + ' ' + f(C.toFen(i.amount))).join('、')}　<span class="muted">${{ confirming: '等确认', locked: x.settlement_id ? '已结算' : '已确认', draft: '草稿' }[x.status] || ''}</span></button>`).join('')
            || '<div class="small muted">银行返点这类钱晚到账，到了以后点“补记返点”。原单不用重新确认。</div>'}</div>` : ''}
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
            <div class="seg types" role="group" aria-label="房屋类型">${C.DEAL_TYPES.map((t) => `<button type="button" data-type="${t}" aria-pressed="${d.type === t}" ${dis}>${t === '二手买卖' ? '二手' : t === '合作' ? '🤝 合作' : t}</button>`).join('')}</div></div>
          <div class="field" id="house-box"><span>房子</span>
            <div class="lf-pair"><select id="f-comm" aria-label="小区" ${dis}></select><input id="f-unit" list="f-units" value="" placeholder="坐落，例如 7幢601" aria-label="坐落" autocomplete="off" ${dis}></div>
            <input id="f-comm-other" placeholder="写小区名字" aria-label="其他小区名字" hidden ${dis}>
            <datalist id="f-units"></datalist>
            <div id="f-house-info" class="small muted"></div></div>
          <label class="field" id="partner-box" hidden>合作的中介<input id="f-partner" value="${esc(d.partner || '')}" placeholder="例如：我爱我家" ${dis}></label>
          <label class="field" id="title-box" hidden>楼盘 / 房号（新房）<input id="f-title" value="${esc(d.title)}" placeholder="例如：某某新楼盘 3-502" ${dis}></label>
          <div class="row" style="flex-wrap:nowrap">
            <label class="field grow" id="owner-box" style="min-width:0">房东名字<input id="f-owner" value="${esc(d.owner_name || '')}" placeholder="例如：刘先生" ${dis}></label>
            <label class="field grow" style="min-width:0">客户名字<input id="f-cust" value="${esc(d.customer_name || '')}" placeholder="例如：陈女士" ${dis}></label>
          </div>
          <label class="field"><span id="price-l">成交价（万元）</span><input id="f-price" inputmode="decimal" autocomplete="off" value="${d.deal_price == null ? '' : esc(d.deal_price)}" placeholder="例如：168" ${dis}></label>
          <div class="phones small" id="f-owner-phones"></div>
          <div class="phones small">${d.customer_phone ? `客户电话（${d.customer_by ? esc(d.customer_by) + ' 填的' : '业务员填的'}）：<a class="tel" href="tel:${esc(d.customer_phone.replace(/[^\d+]/g, ''))}">${esc(d.customer_name || '客户')} ${esc(d.customer_phone)} 📞</a>`
            : '<span class="muted">客户电话：不用你填，客户方业务员确认时会补上，补好了会自动显示在这里</span>'}</div>
        </div>
        <div class="card"><h3>收入（勾选这一单有的）</h3><div id="income-rows"></div>
          <div class="small muted" id="income-tip" style="margin-top:6px"></div></div>
        <div class="card"><h3>这一单的支出</h3><div id="expense-rows"></div>
          <div class="small muted" style="margin-top:6px">介绍费写介绍人名字。维护费一行一个人：选谁垫的钱、写备注（例如请吃饭）和金额，好几个人垫钱就点“＋ 再加一个人”。选了名字的，结算时这笔钱会还给这个人；店里（周姐）付的就选“周姐”。</div></div>
        <div class="card stack" id="listing-box"><h3>房源方业务员（可多选）</h3><div class="chips">${chips('listing_agents')}</div></div>
        <div class="card stack"><h3 id="client-h">客户方业务员（可多选）</h3><div class="chips">${chips('client_agents')}</div></div>
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
      const h = house();
      d.listing_id = d.type !== '新房' && h.listing ? h.listing.id : null;
      d.deal_date = $('#f-date', sheet).value; d.note = $('#f-note', sheet).value.trim();
      d.title = d.type === '新房' ? $('#f-title', sheet).value.trim() : h.comm || h.unit ? `${h.comm} ${h.unit}`.trim() : d.title;
      { const pv = $('#f-price', sheet).value.replace(/[^\d.]/g, ''); d.deal_price = pv === '' ? null : Number(pv); }
      d.owner_name = d.type === '新房' ? '' : $('#f-owner', sheet).value.trim(); d.partner = d.type === '合作' ? $('#f-partner', sheet).value.trim() : ''; d.customer_name = $('#f-cust', sheet).value.trim();
      ['incomes', 'expenses'].forEach((k) => {
        d[k] = [...sheet.querySelectorAll(`input[type=checkbox][data-kind=${k}]`)].filter((c) => c.checked).flatMap((c) => {
          if (c.dataset.multi) {
            const its = [...sheet.querySelectorAll(`.mline[data-m="${c.dataset.t}"]`)].map((ln) => {
              const it = { type: c.dataset.t, amount: Number(ln.querySelector('[data-mamt]').value || 0) };
              const m = ln.querySelector('[data-mmemo]').value.trim(); if (m) it.memo = m;
              const pb = ln.querySelector('[data-mpaid]').value; if (pb) it.paid_by = pb;
              return it;
            }).filter((it, i, arr) => it.amount || it.memo || it.paid_by || arr.length === 1);
            return its.length ? its : [{ type: c.dataset.t, amount: 0 }];
          }
          const v = sheet.querySelector(`input.amt[data-kind=${k}][data-t="${c.dataset.t}"]`).value;
          const it = { type: c.dataset.t, amount: Number(v || 0) };
          const b = c.dataset.t === '银行返点' && sheet.querySelector('input[data-bank]');
          if (b && b.value.trim()) it.bank = b.value.trim();
          const sd = k === 'incomes' && c.dataset.t === '其他收入' && sheet.querySelector('select[data-side]');
          if (sd && sd.value === 'listing') it.side = 'listing';
          const ex = k === 'expenses' && EXTRA_FIELD[c.dataset.t];
          const xv = ex && sheet.querySelector(`input[data-x2="${c.dataset.t}"]`).value.trim();
          if (xv) it[ex] = xv;
          const pb = k === 'expenses' && sheet.querySelector(`select[data-paid="${c.dataset.t}"]`).value;
          if (pb) it.paid_by = pb;
          return it;
        });
      });
    }
    function preview() {
      collect();
      $('#listing-box', sheet).hidden = C.oneSide(d.type);
      $('#price-l', sheet).textContent = d.type === '租房' ? '成交租金（元/月）' : '成交价（万元）'; $('#f-price', sheet).placeholder = d.type === '租房' ? '例如：2600' : '例如：168';
      $('#client-h', sheet).textContent = d.type === '合作' ? '这一单的业务员（可多选，平分业务员那一半）' : '客户方业务员（可多选）';
      $('#partner-box', sheet).hidden = d.type !== '合作';
      $('#income-tip', sheet).textContent = d.type === '合作' ? '只有“合作总佣金”和合作中介对半分。返点和其他收入不给合作中介、不扣 10%，全部是店面一半、这一单的业务员平分一半。'
        : d.type === '新房' ? '返点都不扣 10%，新房全部归客户方：店面一半、业务员一半。'
        : '返点都不扣 10%，也不按 20/80 分：银行返点、装修返点归客户方，垫资返点归房源方，其他收入选跟哪一方分。每一方还是店面一半、业务员一半。';
      $('#owner-box', sheet).hidden = d.type === '新房';
      const view = { ...d, listing_agents: C.oneSide(d.type) ? [] : d.listing_agents };
      $('#preview', sheet).innerHTML = breakdownHTML(view);
    }
    sheet.addEventListener('input', (e) => {
      // 金额只留数字和一个小数点
      if (e.target.classList.contains('amt')) { const v = e.target.value.replace(/[。，,]/g, '.').replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, ''); if (v !== e.target.value) e.target.value = v; }
      preview();
    });
    sheet.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        const on = e.target.checked, t = e.target.dataset.t, k = e.target.dataset.kind;
        if (e.target.dataset.multi) {
          const box = sheet.querySelector(`.mlines[data-ml="${t}"]`); box.hidden = !on;
          if (!on) { box.querySelectorAll('.mline[data-m]').forEach((ln, i) => { if (i) ln.remove(); }); box.querySelectorAll('input').forEach((x) => { x.value = ''; }); box.querySelectorAll('select').forEach((x) => { x.value = ''; }); }
          box.querySelectorAll('input,select,button').forEach((x) => { x.disabled = !on; });
          if (on) box.querySelector('[data-mamt]').focus();
          preview(); return;
        }
        const a = sheet.querySelector(`input.amt[data-kind=${k}][data-t="${t}"]`); a.disabled = !on; if (on) a.focus(); else a.value = '';
        if (k === 'expenses') {
          const xi = sheet.querySelector(`input[data-x2="${t}"]`); if (xi) { xi.disabled = !on; if (!on) xi.value = ''; }
          const ps = sheet.querySelector(`select[data-paid="${t}"]`); if (ps) { ps.disabled = !on; ps.hidden = !on; if (!on) ps.value = ''; }
        }
        if (t === '银行返点') { const bk = sheet.querySelector('input[data-bank]'); bk.disabled = !on; if (!on) bk.value = ''; }
        if (t === '其他收入' && k === 'incomes') { const sd = sheet.querySelector('select[data-side]'); if (sd) { sd.disabled = !on; if (!on) sd.value = 'client'; } }
      }
      preview();
    });
    sheet.addEventListener('click', (e) => {
      const add = e.target.closest('[data-madd]'), del = e.target.closest('.mdel');
      if (add) { add.insertAdjacentHTML('beforebegin', mline(add.dataset.madd, null, true)); add.previousElementSibling.querySelector('[data-mpaid]').focus(); preview(); }
      if (del) { const ln = del.closest('.mline'); if (ln.parentNode.querySelectorAll('.mline[data-m]').length > 1) ln.remove(); else { ln.querySelectorAll('input').forEach((x) => { x.value = ''; }); ln.querySelector('select').value = ''; } preview(); }
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
    if ($('#s-addon', sheet)) $('#s-addon', sheet).onclick = () => { close(); openAddon(deal, null); };
    sheet.querySelectorAll('[data-addon]').forEach((b) => b.onclick = () => { close(); openAddon(deal, state.deals.find((x) => String(x.id) === b.dataset.addon)); });
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
      if (C.oneSide(d.type)) d.listing_agents = [];
      if (d.type === '合作' && !d.partner) return toast('请写合作的中介名字');
      if (!U.people(d).length) return toast('请先选这一单的业务员');
      if (d.type !== '新房') {
        const h = house();
        if (!h.comm || !h.unit) return toast('请选小区、填坐落');
        if (!h.listing) {
          // 房源里没有：自动新建一条（只有基本信息），和这一单绑在一起
          const nl = { kind: d.type === '租房' ? '出租' : '出售', community: h.comm, unit: h.unit, owners: d.owner_name ? d.owner_name.split(/[、，,\s]+/).filter(Boolean).map((n) => ({ name: n, phone: '' })) : [], agents: (d.type === '合作' ? d.client_agents : d.listing_agents).slice(), status: 'active', note: '', note_log: [], elevator: false, needs_info: true, created_at: today() };
          d.listing_id = await run(() => S.saveListing(nl));
        }
      }
      await run(() => S.saveDeal(d, send)); close(); toast(deal ? '已保存' : '已保存，打开这一单可以生成结算单发到群里'); await reload();
    };
    // 房子：只填小区 + 坐落。房源里有这套就自动关联；没有的话，保存时自动新建一条房源（详细信息以后到房源里补）
    const cur = state.listings.find((l) => l.id === d.listing_id);
    const extraC = [...new Set(state.listings.map((l) => l.community).filter((c) => c && !COMMUNITIES.includes(c)))];
    const allC = [...COMMUNITIES, ...extraC];
    const fComm = $('#f-comm', sheet), fOther = $('#f-comm-other', sheet), fUnit = $('#f-unit', sheet);
    // 老单子没关联房源：小区认得出来就拆开，认不出来就整段放进坐落
    let c0 = cur ? cur.community : '', u0 = cur ? cur.unit : '';
    if (!cur && d.title && d.type !== '新房') { const m = allC.find((c) => d.title.startsWith(c)); if (m) { c0 = m; u0 = d.title.slice(m.length).trim(); } else u0 = d.title; }
    const isOther = c0 && !allC.includes(c0);
    fComm.innerHTML = `<option value="">选小区</option><option value="__other" ${isOther ? 'selected' : ''}>其他（自己填）</option>${allC.map((c) => `<option ${c === c0 ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    fOther.value = isOther ? c0 : ''; fOther.hidden = !isOther; fUnit.value = u0;
    function house() {
      const comm = (fComm.value === '__other' ? fOther.value : fComm.value).trim(), unit = fUnit.value.trim();
      const k = houseKey({ community: comm, unit });
      return { comm, unit, listing: comm && unit ? state.listings.find((l) => houseKey(l) === k) : null };
    }
    let autoOwner = '';
    const showHouse = () => {
      const isNew = d.type === '新房';
      $('#house-box', sheet).hidden = isNew; $('#title-box', sheet).hidden = !isNew;
      if (isNew) { $('#f-owner-phones', sheet).innerHTML = ''; return; }
      $('#f-units', sheet).innerHTML = state.listings.filter((l) => l.community === house().comm && l.status === 'active').map((l) => `<option value="${esc(l.unit)}">`).join('');
      const h = house(), info = $('#f-house-info', sheet), op = $('#f-owner-phones', sheet);
      const ph = h.listing ? (h.listing.owners || []).filter((o) => o.phone) : [];
      op.innerHTML = d.type === '新房' ? '' : ph.length ? '房东电话（房源里的）：' + ph.map((o) => `<a class="tel" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.name)} ${esc(o.phone)} 📞</a>`).join('　')
        : `<span class="muted">房东电话：${h.listing ? '房源里还没填，房源维护人补资料时会填上' : '保存后建好房源，房源维护人补资料时会填上'}，填好会自动显示在这里</span>`;
      const own = $('#f-owner', sheet);
      // 房东名字跟着关联的房源走：换了房子，之前自动带出来的名字也换掉（手动改过的不动）
      const names = h.listing ? (h.listing.owners || []).map((o) => o.name).filter(Boolean).join('、') : '';
      if (!own.value.trim() || own.value === autoOwner) { own.value = names; autoOwner = names; }
      if (!h.comm || !h.unit) { info.textContent = '选小区、填坐落，房源里有的会自动关联'; return; }
      if (h.listing && h.listing.id !== (deal && deal.listing_id) && h.listing.status !== 'active') { info.textContent = `⚠ 这套房源已经是“${L_STATUS[h.listing.status](h.listing.kind)}”，确认没有记重吗？`; return; }
      info.textContent = h.listing ? (deal && h.listing.id === deal.listing_id ? `✓ 已关联房源（${L_STATUS[h.listing.status](h.listing.kind)}），详细信息在“房源”里看` : '✓ 已关联房源，保存后房源自动变成已售 / 已租') : '房源里还没有这套，保存时会自动新建一条房源（详细信息以后到房源里补）';
    };
    fComm.onchange = () => { fOther.hidden = fComm.value !== '__other'; if (!fOther.hidden) fOther.focus(); showHouse(); preview(); };
    fOther.oninput = fUnit.oninput = () => { showHouse(); };
    sheet.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => setTimeout(showHouse)));
    showHouse();
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
        <button class="btn-primary btn-block" id="stmt">看结算单 / 下载 PDF</button>
        <button class="btn-danger btn-block" id="cancel-stl">撤销这次结算</button>
      </div>
      <div class="sheet-actions"><button id="close" class="btn-block">返回</button></div>`, s.name);
    const close = () => sheet.remove();
    $('#close', sheet).onclick = close;
    $('#stmt', sheet).onclick = () => openStatement({ title: '结算单', sub: s.name, deals: ds, settled: true });
    twice($('#cancel-stl', sheet), '撤销后这些单子变回“待结算”，再点一次', async () => { await run(() => S.cancelSettlement(sid)); close(); await reload(); toast('已撤销'); });
  }

  function openSummaryPicker(internal) {
    const okDeals = state.deals.filter((d) => d.status === 'locked'); // 只算业务员都确认过的（包括已经结算的）
    const months = [...new Set(okDeals.map((d) => d.deal_date.slice(0, 7)))].sort().reverse();
    const sheet = openSheet(`
      <div class="wrap stack">
        <h2>${internal ? '店面对账单' : '业务员结算单'}</h2>
        ${internal ? '<div class="notice err small">只给店面自己看：包括每位业务员和店面各拿多少，用来对账。不要发到群里。</div>'
          : '<div class="notice info small">发到群里用：写清每位业务员一共应得多少，上面不显示店面拿多少。</div>'}
        <div class="small muted">只包括业务员都已经确认的单子（已经结算过的也算在内）。还在等确认的单子不会出现在这里。</div>
        ${months.length ? '' : '<div class="card muted">还没有业务员都确认过的单子。</div>'}
        <div class="card stack"><h3>1. 选月份</h3>${months.map((m) => `<label class="row" style="gap:10px"><input type="checkbox" data-m="${m}" checked style="width:22px;height:22px;min-height:0">${monthLabel(m)}</label>`).join('')}</div>
        <div class="card stack"><h3>2. 截止到哪一单</h3>
          <select id="sp-end" aria-label="截止到哪一单"></select>
          <div class="small muted" id="sp-count"></div></div>
      </div>
      <div class="sheet-actions"><button id="sp-cancel">取消</button><button class="btn-primary" id="sp-go">生成${internal ? '店面对账单' : '业务员结算单'}</button></div>`, '结算单');
    const picked = () => {
      const ms = [...sheet.querySelectorAll('[data-m]')].filter((c) => c.checked).map((c) => c.dataset.m);
      return okDeals.filter((d) => ms.includes(d.deal_date.slice(0, 7))).sort((a, b) => a.deal_date.localeCompare(b.deal_date) || a.id - b.id);
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
          ${exportButtons()}
        </div>
        <div class="card stack">
          <div><h1>店面收入</h1><div class="muted">${span}</div><div class="muted small">只给店面自己看，不要发到群里。</div></div>
          <div class="tiles">
            <div class="tile"><div class="small muted">总账</div><div class="v num">${f(tot.net)}</div></div>
            <div class="tile"><div class="small muted">店面一共得</div><div class="v num">${f(tot.store)}</div></div>
            <div class="tile"><div class="small muted">业务员一共得</div><div class="v num">${f(tot.agents)}</div></div>
            <div class="tile"><div class="small muted">店面利润（不含 10% 维护）</div><div class="v num">${f(tot.store - tot.maint)}</div><div class="small muted">店面一共得 减去 10% 维护 ${f(tot.maint)}</div></div>
          </div>
          <div class="tablewrap"><table><thead><tr><th>月份</th><th class="r">单数</th><th class="r">总账</th><th class="r">维护成本</th><th class="r">店面合计</th><th class="r">业务员合计</th></tr></thead><tbody>
            ${body || '<tr><td colspan="6" class="muted">这段时间没有单子</td></tr>'}
            ${tr('合计', tot, true)}
          </tbody></table></div>
          <div class="small muted">店面合计 = 每单佣金部分的 10% 维护成本（返点不扣，新房不扣）+ 房源方和客户方里店面的一半。这段时间收入 ${f(tot.income)}，支出 ${f(tot.expense)}。</div>
        </div>
      </div>
      <div class="sheet-actions"><button id="iclose" class="btn-block">返回</button></div>`, '店面收入');
    sheet.id = 'statement'; document.body.classList.add('printing');
    const close = () => { sheet.remove(); document.body.classList.remove('printing'); };
    $('#iclose', sheet).onclick = close;
    const go = (a, b) => { close(); openStoreIncome(a, b); };
    $('#in-from', sheet).onchange = () => go($('#in-from', sheet).value, $('#in-to', sheet).value);
    $('#in-to', sheet).onchange = () => go($('#in-from', sheet).value, $('#in-to', sheet).value);
    bindExport(sheet, '店面收入');
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
        <div class="stack no-print" style="gap:6px"><span class="muted small">结算单预览</span>${exportButtons()}</div>
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
            <div class="bd-group"><span>减：店面维护成本（只扣佣金部分，新房不扣）</span><span class="num">-${f(t.maint)}</span>
              <span class="bd-key">纯利润</span><span class="num bd-key">${f(t.net - t.maint)}</span></div>
            ${internal ? `<div class="bd-group"><span>店面维护成本</span><span class="num">${f(t.maint)}</span><span>房源方、客户方里店面的一半</span><span class="num">${f(t.store - t.maint)}</span>
              <span class="bd-key">店面合计</span><span class="num bd-key">${f(t.store)}</span></div>` : ''}
            <div class="bd-group">${t.reimb ? `<span>业务员分成</span><span class="num">${f(agentsTotal - t.reimb)}</span><span>加：还业务员垫付的钱</span><span class="num">${f(t.reimb)}</span>` : ''}<span class="bd-key" style="border:0;padding:0">业务员合计</span><span class="num bd-key" style="border:0;padding:0">${f(agentsTotal)}</span></div>
            ${internal ? `<div class="bd-group"><span class="small muted" style="grid-column:1/-1">核对：店面合计 + 业务员分成 = 总账</span><span>${f(t.store)} + ${f(agentsTotal - t.reimb)}</span><span class="num">${f(t.store + agentsTotal - t.reimb)}</span></div>` : ''}
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
          <div class="small muted">分账规则：每单总账 = 收入 − 支出；再扣店面维护成本是纯利润（只扣佣金部分：（佣金 − 支出）× 10%，返点等其他收入不扣；新房不扣）；佣金部分的纯利润按房源方 20%、客户方 80% 分（新房全部算客户方）；返点直接归一方：银行返点、装修返点归客户方，垫资返点归房源方，其他收入看记账时选的哪一方；合作单（和别的中介合作）总佣金一半给对方，我们这一半不扣 10%，店面一半、业务员平分一半；每一块店面和业务员各一半，业务员那一半由这一单的业务员平分。除不尽的零头归业务员。业务员先垫付的支出，结算时加回给垫付的人。</div>
          <div class="small muted">生成时间：${new Date().toLocaleString('zh-CN')}</div>
        </div>
      </div>
      <div class="sheet-actions"><button id="sclose" class="btn-block">返回</button></div>`, title);
    sheet.id = 'statement';
    document.body.classList.add('printing');
    $('#sclose', sheet).onclick = () => { sheet.remove(); document.body.classList.remove('printing'); if (onClose) onClose(); };
    bindExport(sheet, title);
  }

  // ---------- 房源记录 ----------
  const fmtTime = (t) => { if (!t) return ''; const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const feedbackHTML = (fb) => (fb && fb.length) ? `<div class="fb-list">${fb.slice().reverse().map((x) => `<div class="fb"><div class="small muted"><b>${esc(x.author)}</b>　${fmtTime(x.created_at)}</div><div>${esc(x.content)}</div></div>`).join('')}</div>` : '<div class="small muted">还没有反馈</div>';
  const L_STATUS = { active: (k) => k === '出租' ? '在租' : '在售', done: (k) => k === '出租' ? '已租' : '已售', off: () => '下架' };
  const houseKey = (x) => ((x.community || '') + '|' + (x.unit || '')).replace(/\s/g, '');
  const dealPrice = (x) => { const d = state.deals.filter((y) => y.listing_id === x.id && !y.parent_id && y.deal_price != null).sort((a, b) => b.deal_date.localeCompare(a.deal_date))[0]; return d ? d.deal_price : null; };
  const soldText = (x, v) => `成交 ${Number(v).toLocaleString()} ${x.kind === '出租' ? '元/月' : '万'}`;
  const priceText = (x) => x.price == null || x.price === '' ? '价格未填' : x.kind === '出租' ? `${Number(x.price).toLocaleString()} 元/月` : `${Number(x.price).toLocaleString()} 万`;
  const lTag = (k) => `<span class="tc ${k === '出租' ? 'tt-b' : 'tt-a'}">${k === '出租' ? '出租' : '出售'}</span>`;
  // ===== 房源：店面和业务员两边共用（改的时候两个文件一起改） =====
  const CATS = ['小户', '小户带阁楼', '中户', '中户带阁楼', '大户', '大户带阁楼', '特大户', '特大户带阁楼', '商品房', '商铺'];
  const zones = (name, n) => Array.from({ length: n }, (_, i) => `${name}${'一二三四五六七八九'[i]}区`);
  const COMMUNITIES = ['东亭家园', '厦亭家园', ...zones('怡邻花园', 5), '悬珠花园', '阳澄人家', '亭南新村', ...zones('青苑新村', 6), ...zones('畅苑新村', 4), '青灯新村', '亭苑', '金陵花园', '绿地', '融锦苑', '雍合湾', '唯锦苑', '唯亭苑'];
  const layoutText = (x) => x.rooms != null && x.rooms !== '' ? `${x.rooms}室${x.halls || 0}厅` : (x.layout || '');
  const cardSpec = (x) => [x.category, layoutText(x), x.area ? x.area + '㎡' : ''].filter(Boolean).map(esc).join(' · ') || '还没填户型';  // 列表卡片只放最简单的
  const specLine = (x) => [x.category, layoutText(x), x.area ? x.area + '㎡' : '', x.decoration, x.elevator ? '有电梯' : '没电梯'].filter(Boolean).map(esc).join(' · ');
  const LF0 = { kind: '', status: '', comm: '', cat: '', rooms: '', halls: '', amin: '', amax: '', elev: '' };
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
    return !kw || window.Calc.fuzzy([x.community + x.unit, x.category, layoutText(x), ...(x.owners || []).flatMap((o) => [o.name, o.phone]), ...(x.agents || []), x.note], kw);
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
  function renderListings() {
    const F = state.lf = { ...LF0, q: '', ...state.lf };
    const list = state.listings.filter((x) => matchListing(x, F));
    const hasDeal = (x) => state.deals.some((d) => d.listing_id === x.id);
    const card = (x) => `<div class="card listing${x.status === 'off' ? ' off' : x.status === 'done' ? ' done' : ''}" data-l="${x.id}" role="button" tabindex="0">
        <div class="lstrip ${x.kind === '出租' ? 'k-rent' : 'k-sale'}"><span>${x.kind === '出租' ? '出租' : '出售'}</span><span>${L_STATUS[x.status](x.kind)}</span></div>
        ${x.status === 'done' ? `<span class="seal" aria-label="已成交">${x.kind === '出租' ? '已租' : '已售'}</span>` : ''}
        <div class="row" style="gap:12px;flex-wrap:nowrap;align-items:flex-start">
          <div class="grow stack" style="min-width:0;text-align:left;gap:2px"><b style="font-size:18px">${esc(x.community || '（没写小区）')} ${esc(x.unit)}</b>
            <div class="small muted">${x.needs_info ? '<span class="pill warn">等维护人补全</span>' : cardSpec(x)}</div>
            <div>${dealPrice(x) != null ? `<b class="num" style="font-size:18px;color:#c0392b">${soldText(x, dealPrice(x))}</b> <span class="small muted">挂牌 ${priceText(x)}</span>` : `<b class="num" style="font-size:18px;color:var(--accent)">${priceText(x)}</b>`}</div></div>
          ${x.photo_thumb ? `<img class="lphoto" data-lphoto="${x.id}" src="${x.photo_thumb}" alt="房子照片，点开看大图">` : ''}</div>
        ${x.status === 'active' && !hasDeal(x) ? `<div class="row" style="justify-content:flex-end"><button class="btn-primary" data-ldeal="${x.id}">成交了，去记账 ›</button></div>` : ''}</div>`;
    shell(`
      <button class="add-listing" id="ladd"><span class="plus">＋</span><span><b>录入新房源</b><span class="small">同一套房子只能录一次</span></span></button>
      ${filterCard(F, state.listings, ['active', 'done', 'off'])}
      <div class="lf-count">找到 <b>${list.length}</b> 套房源</div>
      ${list.map(card).join('') || `<div class="card muted">${state.listings.length ? '没有符合条件的房源，可以点上面“清空条件”' : '还没有房源。点“＋ 录入新房源”开始记。'}</div>`}`);
    $('#ladd').onclick = () => openListing(null);
    bindFilter(app, F, renderListings);
    app.querySelectorAll('[data-l]').forEach((b) => {
      const go = (e) => { if (e.target.closest('a.tel')) return; if (e.target.closest('[data-lphoto]')) { e.stopPropagation(); return Photo.show(S.listingPhoto(Number(b.dataset.l))); } const x = state.listings.find((y) => String(y.id) === b.dataset.l); if (e.target.closest('[data-ldeal]')) dealFromListing(x); else openListing(x); };
      b.onclick = go; b.onkeydown = (e) => { if (e.key === 'Enter') go(e); };
    });
  }
  // 从房源去记账：自动带上房子、房东、维护人，不用重复输入
  function dealFromListing(x) {
    state.tab = 'deals'; render();
    openDeal(null, { listing_id: x.id, type: x.kind === '出租' ? '租房' : '二手买卖', title: `${x.community} ${x.unit}`, owner_name: (x.owners || []).map((o) => o.name).filter(Boolean).join('、'), listing_agents: (x.agents || []).slice() });
    toast(`房子已经带过来了，填好钱保存，房源就会自动变成“${L_STATUS.done(x.kind)}”`);
  }
  function openListing(src) {
    const x = src ? JSON.parse(JSON.stringify(src)) : { kind: state.lf.kind || '出售', community: '', unit: '', category: '', rooms: null, halls: null, elevator: false, area: '', decoration: '', price: '', owners: [], agents: [], status: 'active', note: '', created_at: today() };
    x.owners = x.owners || []; x.agents = x.agents || [];
    const names = state.agents.filter((a) => a.active || x.agents.includes(a.name)).map((a) => a.name);
    const deals = src ? state.deals.filter((d) => d.listing_id === src.id) : [];
    const oline = (o) => `<div class="oline"><input data-on value="${esc(o ? o.name : '')}" placeholder="房东名字" aria-label="房东名字"><input data-op value="${esc(o ? o.phone : '')}" placeholder="电话" inputmode="tel" aria-label="房东电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button><button type="button" class="mdel" data-odel aria-label="删掉这个房东">×</button></div>`;
    const opt = (list, v) => list.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
    const nopt = (n, v, suffix) => Array.from({ length: n }, (_, i) => `<option value="${i}" ${v === i ? 'selected' : ''}>${i}${suffix}</option>`).join('');
    const inp = (id, label, v, ph, extra = '') => `<label class="field grow" style="min-width:0">${label}<input id="${id}" value="${esc(v == null ? '' : v)}" placeholder="${ph}" ${extra}></label>`;
    // 有人用“其他”录过的新小区（例如唐宁府），以后录入和筛选都会自动出现
    const extra = [...new Set(state.listings.map((l) => l.community).filter((c) => c && !COMMUNITIES.includes(c)))].sort((a, b) => a.localeCompare(b, 'zh'));
    const other = x.community && !COMMUNITIES.includes(x.community) && !extra.includes(x.community);
    // 房源维护人 = 负责的业务员：第一次保存后锁定，只有店面后台点“修改”才能改（业务员那边永远不能改）
    let agentsLocked = !!(src && src.agents && src.agents.length);
    const chipsHTML = () => agentsLocked ? `<b style="font-size:18px">${esc(x.agents.join('、'))}</b>` : names.map((n) => `<button type="button" class="chip" data-ag="${esc(n)}" aria-pressed="${x.agents.includes(n)}">${esc(n)}</button>`).join('');
    const sheet = openSheet(`<div class="wrap stack">
        <h2>${src ? '房源' : '录入新房源'}</h2>
        ${x.needs_info ? `<div class="notice">这套是记账时自动建的，户型、面积这些还没填。房源维护人（${esc(x.agents.join('、') || '还没选')}）的后台会提示他们补全，谁先补完算谁的。你在这里直接填好保存也行。</div>`
          : x.filled_by ? `<div class="small muted">记账时自动建的，${esc(x.filled_by)} 补全了详细信息</div>` : ''}
        <div class="card stack" id="ph-box" style="gap:8px"></div>
        <div class="card stack">
          <div class="seg" role="group" aria-label="出售还是出租" style="grid-template-columns:repeat(2,1fr)">${['出售', '出租'].map((k) => `<button type="button" data-kind="${k}" aria-pressed="${x.kind === k}">${k}</button>`).join('')}</div>
          <label class="field">小区<select id="l-comm-sel"><option value="">请选择小区</option><option value="__other" ${other ? 'selected' : ''}>其他（新拓展的小区，自己填）</option><optgroup label="常用小区">${opt(COMMUNITIES, x.community)}</optgroup>${extra.length ? `<optgroup label="后来录入的小区">${opt(extra, x.community)}</optgroup>` : ''}</select></label>
          <input id="l-comm" value="${esc(other ? x.community : '')}" placeholder="写小区名字" aria-label="其他小区名字" ${other ? '' : 'hidden'}>
          ${inp('l-unit', '坐落', x.unit, '例如：7号楼2单元601')}
          <div id="l-dup" class="notice err" hidden></div>
          <label class="field">户型分类<select id="l-cat"><option value="">—</option>${opt(CATS, x.category)}</select></label>
          <div class="row" style="flex-wrap:nowrap" id="l-rh">
            <label class="field grow" style="min-width:0">几室<select id="l-rooms"><option value="">—</option>${nopt(8, x.rooms, '室')}</select></label>
            <label class="field grow" style="min-width:0">几厅<select id="l-halls"><option value="">—</option>${nopt(5, x.halls, '厅')}</select></label></div>
          <div class="row" style="flex-wrap:nowrap">${inp('l-area', '面积（㎡）', x.area, '例如：118', 'inputmode="decimal"')}
            <label class="field grow" style="min-width:0">装修<select id="l-deco"><option value="">—</option>${opt(['毛坯', '简装', '精装', '豪装'], x.decoration)}</select></label></div>
          <div class="field"><span>电梯</span><div class="seg" role="group" aria-label="有没有电梯" style="grid-template-columns:repeat(2,1fr)">${[[true, '有电梯'], [false, '没电梯']].map(([v, t]) => `<button type="button" data-elev="${v}" aria-pressed="${!!x.elevator === v}">${t}</button>`).join('')}</div></div>
          ${inp('l-price', `<span id="l-plabel">${x.kind === '出租' ? '月租（元）' : '总价（万元）'}</span>`, x.price, x.kind === '出租' ? '例如：2600' : '例如：168', 'inputmode="decimal"')}
        </div>
        <div class="card stack">
          <div class="stack" style="gap:8px"><span class="small muted">房东（名字、电话）</span>
            <div id="olines" class="stack" style="gap:8px">${(x.owners.length ? x.owners : [null]).map(oline).join('')}</div>
            <button type="button" id="oadd" style="align-self:flex-start">＋ 再加一个房东</button>
            ${deals.length ? `<span class="small muted" style="margin-top:6px">${x.kind === '出租' ? '租客' : '客户'}（名字、电话）</span>
            ${deals.map((d) => `<div class="oline nodel cline" data-deal="${d.id}"><input data-cn value="${esc(d.customer_name || '')}" placeholder="等业务员填" aria-label="客户名字"><input data-cp value="${esc(d.customer_phone || '')}" placeholder="等业务员填" inputmode="tel" aria-label="客户电话"><button type="button" class="ocall" data-call aria-label="拨打这个电话">📞</button></div>`).join('')}
            <div class="small muted">只有店面和这一单的客户方业务员能改。</div>` : ''}</div>
          <div class="stack" style="gap:6px">
            <div class="row between"><span class="small muted">房源维护人（负责的业务员，可多选）</span>${agentsLocked ? '<button type="button" id="ag-unlock" class="linkish">修改</button>' : ''}</div>
            <div class="small muted" id="ag-tip">${agentsLocked ? '已锁定。第一次填好后就不能随便改，确实要换人请点“修改”（只有店面能改，业务员那边改不了）。' : '第一次保存后就会锁定。'}</div>
            <div class="chips" id="ag-chips">${chipsHTML()}</div></div>
          <label class="field">状态<select id="l-status">${['active', 'done', 'off'].map((s) => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${L_STATUS[s](x.kind)}</option>`).join('')}</select></label>
          ${deals.length ? `<div class="notice">这套房子已经记账：${deals.map((d) => `${esc(d.deal_date)} ${esc(d.title || d.type)}${d.deal_price != null ? '，' + soldText(x, d.deal_price) : '（成交价还没填，到记账里这一单填）'}`).join('；')}</div>` : ''}
        </div>
        <div class="card stack"><h3>备注</h3>
          <textarea id="l-note" rows="2" placeholder="例如：满五唯一、钥匙在店里、随时看房" aria-label="备注">${esc(x.note)}</textarea>
          ${noteLogHTML(x)}</div>
        ${src ? `<div class="card stack"><h3>联系反馈（${(x.feedback || []).length} 条）</h3>
          <textarea id="fb-text" rows="2" placeholder="写一条反馈，例如：房东说价格可以再谈" aria-label="反馈内容"></textarea>
          <button class="btn-primary" id="fb-add">添加反馈</button>
          ${feedbackHTML(x.feedback)}</div>` : ''}
        ${src && !deals.length ? '<button id="l-deal" class="btn-block">成交了，记一单</button>' : ''}
      </div>
      <div class="sheet-actions"><button id="l-cancel">取消</button>${src ? '<button id="l-del" class="btn-danger">删除</button>' : ''}<button id="l-save" class="btn-primary">保存</button></div>`, '房源');
    const close = () => sheet.remove();
    const phField = Photo.field($('#ph-box', sheet), x.photo_thumb, () => S.listingPhoto(x.id));
    const num = (v) => { v = String(v).replace(/[^\d.]/g, ''); return v === '' ? null : Number(v); };
    const int = (v) => v === '' ? null : Number(v);
    const commVal = () => { const v = $('#l-comm-sel', sheet).value; return (v === '__other' ? $('#l-comm', sheet).value : v).trim(); };
    const findDup = () => { const k = houseKey({ community: commVal(), unit: $('#l-unit', sheet).value }); return !k.startsWith('|') && !k.endsWith('|') && state.listings.find((y) => y.id !== x.id && houseKey(y) === k); };
    const showDup = () => { const d = findDup(), box = $('#l-dup', sheet); box.hidden = !d; if (d) box.textContent = `系统里已经有这套房子了：${d.community} ${d.unit}（${L_STATUS[d.status](d.kind)}，维护人 ${(d.agents || []).join('、') || '—'}），不能重复录入`; return d; };
    $('#l-comm-sel', sheet).onchange = () => { const o = $('#l-comm-sel', sheet).value === '__other'; $('#l-comm', sheet).hidden = !o; if (o) $('#l-comm', sheet).focus(); showDup(); };
    $('#l-comm', sheet).oninput = showDup; $('#l-unit', sheet).oninput = showDup;
    const shop = () => { $('#l-rh', sheet).hidden = $('#l-cat', sheet).value === '商铺'; };
    $('#l-cat', sheet).onchange = shop; shop();
    sheet.querySelectorAll('[data-elev]').forEach((b) => b.onclick = () => { x.elevator = b.dataset.elev === 'true'; sheet.querySelectorAll('[data-elev]').forEach((y) => y.setAttribute('aria-pressed', y === b)); });
    if ($('#ag-unlock', sheet)) $('#ag-unlock', sheet).onclick = (e) => {
      agentsLocked = false; $('#ag-chips', sheet).innerHTML = chipsHTML(); e.target.remove();
      $('#ag-tip', sheet).textContent = '现在可以改了，改好点“保存”，保存后又会锁上。';
    };
    const collect = () => {
      const isShop = $('#l-cat', sheet).value === '商铺';
      Object.assign(x, {
        community: commVal(), unit: $('#l-unit', sheet).value.trim(), category: $('#l-cat', sheet).value,
        rooms: isShop ? null : int($('#l-rooms', sheet).value), halls: isShop ? null : int($('#l-halls', sheet).value),
        area: num($('#l-area', sheet).value), decoration: $('#l-deco', sheet).value,
        price: num($('#l-price', sheet).value), status: $('#l-status', sheet).value, note: $('#l-note', sheet).value.trim(),
        owners: [...sheet.querySelectorAll('#olines .oline')].map((ln) => ({ name: ln.querySelector('[data-on]').value.trim(), phone: ln.querySelector('[data-op]').value.trim() })).filter((o) => o.name || o.phone) });
      x.layout = layoutText(x);
    };
    $('#oadd', sheet).onclick = () => { $('#olines', sheet).insertAdjacentHTML('beforeend', oline(null)); $('#olines', sheet).lastElementChild.querySelector('input').focus(); };
    sheet.addEventListener('click', (e) => {
      const del = e.target.closest('[data-odel]');
      if (del) { const box = $('#olines', sheet); if (box.children.length > 1) del.parentNode.remove(); else del.parentNode.querySelectorAll('input').forEach((i) => { i.value = ''; }); }
      const ag = e.target.closest('[data-ag]');
      if (ag && !agentsLocked) { const n = ag.dataset.ag, i = x.agents.indexOf(n); if (i >= 0) x.agents.splice(i, 1); else x.agents.push(n); ag.setAttribute('aria-pressed', i < 0); }
    });
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => {
      x.kind = b.dataset.kind; sheet.querySelectorAll('[data-kind]').forEach((y) => y.setAttribute('aria-pressed', y === b));
      $('#l-plabel', sheet).textContent = x.kind === '出租' ? '月租（元）' : '总价（万元）'; $('#l-price', sheet).placeholder = x.kind === '出租' ? '例如：2600' : '例如：168';
      $('#l-status', sheet).options[0].textContent = L_STATUS.active(x.kind); $('#l-status', sheet).options[1].textContent = L_STATUS.done(x.kind);
    });
    if ($('#fb-add', sheet)) $('#fb-add', sheet).onclick = async () => {
      const t = $('#fb-text', sheet).value.trim(); if (!t) return toast('请先写反馈内容');
      await run(() => S.addFeedback(x.id, '周姐', t)); await loadAll(); close(); openListing(state.listings.find((y) => y.id === x.id)); toast('反馈已添加');
    };
    const save = async () => {
      collect();
      if (showDup()) { toast('这套房子已经录过了，不能重复录入'); $('#l-dup', sheet).scrollIntoView({ block: 'center' }); return false; }
      if (!x.community) { toast('请选小区（不在列表里就选第一个“其他”，自己填）'); return false; }
      if (!x.unit) { toast('请填坐落'); return false; }
      if ((src ? src.note || '' : '') !== x.note) { x.note_by = '周姐'; x.note_at = new Date().toISOString(); x.note_log = [...(x.note_log || []), { by: '周姐', at: x.note_at, note: x.note }]; }
      delete x.feedback;
      // 店面自己把户型面积填上了，就不用再等业务员补全
      if (x.needs_info && (x.category || x.rooms != null || x.area)) { x.needs_info = false; x.filled_by = '周姐'; x.filled_at = new Date().toISOString(); }
      for (const ln of sheet.querySelectorAll('.cline')) {  // 客户名字、电话改了就存回那一单
        const d = state.deals.find((y) => String(y.id) === ln.dataset.deal), cn = ln.querySelector('[data-cn]').value.trim(), cp = ln.querySelector('[data-cp]').value.trim();
        if (d && (cn !== (d.customer_name || '') || cp !== (d.customer_phone || ''))) await run(() => S.setCustomer(d.id, cn, cp));
      }
      const pc = phField.changed(); if (pc !== undefined) { x.photo = pc ? pc.photo : ''; x.photo_thumb = pc ? pc.photo_thumb : ''; }
      await run(() => S.saveListing(x)); await loadAll(); return true;
    };
    $('#l-cancel', sheet).onclick = close;
    $('#l-save', sheet).onclick = async () => { if (await save()) { close(); renderListings(); toast('已保存'); } };
    if ($('#l-del', sheet)) twice($('#l-del', sheet), '再点一次删除', async () => { await run(() => S.deleteListing(x.id)); await loadAll(); close(); renderListings(); toast('已删除'); });
    if ($('#l-deal', sheet)) $('#l-deal', sheet).onclick = async () => {
      if (!(await save())) return;
      close(); dealFromListing(x);
    };
  }

  // ---------- 业务员 ----------
  // 个人密码：6 位随机数字，店面私下发给业务员（存在 phone4 这一列）
  function newCode() {
    const used = new Set(state.agents.map((a) => a.phone4));
    for (;;) { const c = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'); if (!used.has(c)) return c; }
  }
  const isLocked = (a) => (a.fail_count || 0) >= 5;
  const agentPill = (a) => !a.active ? '<span class="pill gray">已停用</span>' : a.auto_confirm ? '<span class="pill ok">自动确认</span>' : isLocked(a) ? '<span class="pill seal">输错太多次，已锁</span>'
    : a.device_token ? '<span class="pill ok">已绑定手机</span>' : '<span class="pill gray">还没绑定手机</span>';
  const codeMsg = (a) => `${a.name}，这是你在文城房产结算确认页面的个人密码：${a.phone4}\n只需要输入一次，请不要告诉别人。确认链接：${CONFIRM_URL()}`;
  function openCodes() {
    const list = state.agents.filter((a) => a.active && !a.auto_confirm);
    const old = list.filter((a) => (a.phone4 || '').length < 6).length;
    const sheet = openSheet(`<div class="wrap stack">
        <h2>业务员个人密码</h2>
        <div class="notice">每个人的密码只私聊发给本人，<b>不要发到群里</b>。点“复制”会复制一段话（名字 + 密码 + 链接），粘贴到和这个人的私聊里发出去就行。</div>
        ${old ? `<div class="notice err">有 ${old} 个人的密码还是以前的手机后 4 位，同事之间可能都知道。建议点下面“全部换成新密码”，再一个个私发。</div>` : ''}
        <div class="card agent-list">${list.map((a) => `<div class="agent-row"><b class="an">${esc(a.name)}</b><b class="num grow" style="letter-spacing:.1em;white-space:nowrap">${esc(a.phone4 || '—')}</b>${isLocked(a) ? agentPill(a) : ''}<button data-new="${a.id}">更新</button><button data-cp="${a.id}">复制</button></div>`).join('')}</div>
        <div class="small muted">谁的密码弄丢了或者被别人知道了，点 TA 旁边的“更新”，只换 TA 一个人的，再把新密码私发给 TA。</div>
        <button id="regen-all">全部换成新密码（大家要重新输一次）</button>
      </div>
      <div class="sheet-actions"><button id="cclose" class="btn-block">返回</button></div>`, '业务员个人密码');
    $('#cclose', sheet).onclick = () => sheet.remove();
    sheet.querySelectorAll('[data-cp]').forEach((b) => b.onclick = () => copy(codeMsg(list.find((a) => String(a.id) === b.dataset.cp))));
    sheet.querySelectorAll('[data-new]').forEach((b) => twice(b, '再点一次', async () => {
      const a = list.find((x) => String(x.id) === b.dataset.new);
      await run(() => S.setCode(a.id, newCode())); await reload(); sheet.remove(); openCodes(); toast(`${a.name}的密码已更新，点“复制”私发给 TA`);
    }));
    twice($('#regen-all', sheet), '确定全部换？再点一次', async () => {
      await run(async () => { for (const a of list) { const c = newCode(); a.phone4 = c; await S.setCode(a.id, c); } });
      await reload(); sheet.remove(); openCodes(); toast('已全部换好，请一个个私发');
    });
  }
  function renderAgents() {
    const rows = state.agents.map((a) => {
      const ds = state.deals.filter((d) => U.involves(d, a.name)); const sum = ds.reduce((x, d) => x + (C.calcDeal(d).people[a.name] || 0), 0);
      const pill = agentPill(a);
      return `<button class="agent-row${a.active ? '' : ' off'}" data-perf="${esc(a.name)}"><b class="an">${esc(a.name)}</b><span class="muted small grow">${ds.length} 单 · <span class="num">${f(sum)}</span></span>${pill}<span class="muted">›</span></button>`;
    }).join('');
    shell(`
      <div class="card stack">
        <h3>业务员确认链接</h3>
        <input id="copy-src" readonly value="${esc(CONFIRM_URL())}" aria-label="确认链接">
        <button id="copy">复制链接</button>
        <div class="small muted">所有业务员用同一个链接。第一次打开选自己的名字，输入店面私发的个人密码，手机就记住了。每个人只能看到自己的钱。</div>
        <button id="codes">查看 / 私发业务员个人密码</button>
      </div>
      <h2>业务员名单（${state.agents.filter((a) => a.active).length} 人）</h2>
      <div class="row" style="flex-wrap:nowrap"><input id="new-name" class="grow" style="min-width:0" placeholder="新来的业务员名字" aria-label="新来的业务员名字"><button id="add-agent">添加</button></div>
      <div class="small muted">添加时会自动生成个人密码。点名字看这个人的每一单，个人密码、解锁、停用也在里面。</div>
      <div class="card agent-list">${rows}</div>
      <div class="row">
        ${S.mode === 'demo' ? '<button id="demo-reset">恢复演示数据</button><a class="btn" href="confirm.html">打开业务员确认页（演示）</a>' : '<button id="logout">退出登录</button>'}
      </div>`);
    $('#copy').onclick = () => copy(CONFIRM_URL());
    $('#codes').onclick = openCodes;
    $('#add-agent').onclick = async () => {
      const n = $('#new-name').value.trim();
      if (!n) return toast('请填名字');
      if (state.agents.some((a) => a.name === n)) return toast('已经有这个名字了');
      await run(() => S.saveAgent({ name: n, phone4: newCode() })); await reload(); openAgent(n); toast('已添加 ' + n + '，把个人密码私发给 TA');
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
    const role = (d) => d.type === '合作' ? '合作' : [d.type !== '新房' && d.listing_agents.includes(name) ? '房源方' : '', d.client_agents.includes(name) ? '客户方' : ''].filter(Boolean).join('、');
    const stTxt = (d) => d.settlement_id ? '已结算' : d.status === 'locked' ? '已确认，等结算' : '等确认';
    const sheet = openSheet(`
      <div class="wrap stack">
        <div class="stack no-print" style="gap:6px"><span class="muted small">业务员业绩</span>${exportButtons()}</div>
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
        ${a && a.auto_confirm ? `<div class="card stack no-print" style="gap:10px">
          <div class="row between"><h3>自动确认</h3>${agentPill(a)}</div>
          <div>${esc(a.name)} 不用手机确认：TA 参与的单子，一发出去就自动算“已确认”，钱照常算、照常结算。其他人都确认后这一单自动锁定。</div>
          <div class="row"><button id="a-auto">改成要手机确认</button><button id="a-active">${a.active ? '停用' : '恢复'}</button></div>
        </div>` : a ? `<div class="card stack no-print" style="gap:10px">
          <div class="row between"><h3>账号</h3>${agentPill(a)}</div>
          <div class="row">
            ${isLocked(a) ? '<button id="a-reset" class="btn-primary">解锁</button>' : a.device_token ? '<button id="a-reset">退出 TA 的手机</button>' : ''}
            <button id="a-active">${a.active ? '停用' : '恢复'}</button>
            <button id="a-auto">设成自动确认</button>
          </div>
          <div class="small muted">密码在业务员页的“查看 / 私发业务员个人密码”里看和更新。不会用手机的人可以点“设成自动确认”：TA 的单子会自动算已确认。输错密码 5 次会锁住，要点“解锁”。不在店里干了可以停用，以前的单子还在。</div>
        </div>` : ''}
      </div>
      <div class="sheet-actions"><button id="aclose" class="btn-block">返回</button></div>`, name);
    sheet.id = 'statement'; document.body.classList.add('printing');
    const close = () => { sheet.remove(); document.body.classList.remove('printing'); };
    $('#aclose', sheet).onclick = close;
    bindExport(sheet, name + '的成交记录');
    sheet.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
      const d = state.deals.find((x) => String(x.id) === b.dataset.d); close();
      openStatement({ title: '单笔结算单', sub: `${d.deal_date}　${d.title || ''}`, deals: [d], onClose: () => openAgent(name) });
    });
    const again = async (msg) => { await reload(); close(); openAgent(name); if (msg) toast(msg); };
    if ($('#code-copy', sheet)) $('#code-copy', sheet).onclick = () => copy(codeMsg(a));
    if ($('#code-new', sheet)) twice($('#code-new', sheet), '确定换？再点一次', async () => { await run(() => S.setCode(a.id, newCode())); await again('已换好，记得私发新密码'); });
    if ($('#a-reset', sheet)) $('#a-reset', sheet).onclick = async () => { await run(() => S.resetBinding(a.id)); await again(isLocked(a) ? '已解锁' : '已退出，TA 要重新输密码'); };
    if ($('#a-auto', sheet)) twice($('#a-auto', sheet), a.auto_confirm ? '确定？再点一次' : '确定自动确认？再点一次', async () => { await run(() => S.saveAgent({ ...a, auto_confirm: !a.auto_confirm })); await again(a.auto_confirm ? '已改成要手机确认' : '已设成自动确认，以后 TA 的单子自动算已确认'); });
    if ($('#a-active', sheet)) $('#a-active', sheet).onclick = async () => { await run(() => S.saveAgent({ ...a, active: !a.active })); await again(a.active ? '已停用' : '已恢复'); };
  }

  // ---------- 登录 ----------
  function renderLogin() {
    app.innerHTML = `<div class="wrap stack" style="max-width:420px;padding-top:40px">
      <img src="icon-512.png" alt="文城房产" style="width:132px;height:132px;border-radius:28px;align-self:center;box-shadow:0 8px 24px rgba(0,0,0,.25)">
      <h1 style="text-align:center">文城房产</h1><div class="muted">请用店面账号登录（每台手机/电脑登录一次即可）</div>
      ${/MicroMessenger/i.test(navigator.userAgent) ? '<div class="notice err">现在是在微信里打开的，微信会清掉登录，所以每次都要重新登录。请点右上角“···”，选“在浏览器打开”，再把它添加到手机主屏幕。</div>' : ''}
      <form id="lf" class="card stack">
        <label class="field">邮箱<input type="email" id="lf-email" autocomplete="username" required></label>
        <label class="field">密码<input type="password" id="lf-pw" autocomplete="current-password" required></label>
        <button class="btn-primary" type="submit">登录</button>
      </form>
      <a href="confirm.html" class="btn" style="text-align:center;display:block;text-decoration:none">我是业务员，点这里确认单子</a>
    </div>`;
    $('#lf').onsubmit = async (e) => { e.preventDefault(); await run(() => S.login($('#lf-email').value.trim(), $('#lf-pw').value)); start(); };
  }

  async function start() {
    if (!(await S.session())) {
      // 这台手机已经用业务员身份确认过（比如旧的桌面图标），直接去业务员页，不显示店面登录
      let t = null; try { t = localStorage.getItem('ledger_aunt_token'); } catch (e) { /* 忽略 */ }
      if (t) { location.replace('confirm.html'); return; }
      return renderLogin();
    }
    await run(loadAll); render();
  }
  start();
})();
