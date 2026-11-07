// 业务员确认页：一个链接，第一次选名字 + 手机号后 4 位，以后自动认出是谁
(function () {
  const S = window.Store, C = window.Calc;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const demoBar = () => S.mode === 'demo' ? '<div class="notice small">演示模式：数据只在这台设备上。<button id="demo-switch" style="min-height:0;padding:2px 8px;font-size:14px">换一个人试试</button> <a href="index.html">回到店面记账</a></div>' : '';
  const bindDemo = () => { const b = $('#demo-switch'); if (b) b.onclick = () => { S.demoForget(); start(); }; };

  function err(msg) { const e = $('#err'); if (e) { e.textContent = msg; e.hidden = false; } }

  async function pickName() {
    const names = await S.auntNames();
    app.innerHTML = `<div class="wrap stack" style="max-width:520px">
      ${demoBar()}
      <h1>店面结算确认</h1>
      <div class="muted">第一次打开，请点您自己的名字。</div>
      <div class="chips">${names.map((n) => `<button class="chip" data-n="${esc(n.name)}" ${n.bound ? 'disabled' : ''}>${esc(n.name)}${n.bound ? '（已登记）' : ''}</button>`).join('')}</div>
      <div class="small muted">名字后面写着“已登记”的，说明已经在一部手机上登记过。如果是您自己换了手机，请找店面重置。</div>
    </div>`;
    bindDemo();
    app.querySelectorAll('.chip').forEach((b) => b.onclick = () => askPhone(b.dataset.n));
  }

  function askPhone(name) {
    app.innerHTML = `<div class="wrap stack" style="max-width:520px">
      <h1>${esc(name)}，您好</h1>
      <form id="pf" class="card stack">
        <label class="field">请输入您手机号的后 4 位<input id="p4" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off" required style="font-size:28px;letter-spacing:.3em;text-align:center"></label>
        <div id="err" class="notice err" hidden></div>
        <button class="btn-primary" type="submit">确定</button>
        <button type="button" id="notme">我不是${esc(name)}，重新选</button>
      </form>
      <div class="small muted">只需要输入这一次，以后这部手机打开就直接是您的账。</div>
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
    const roles = [d.type !== '新房' && d.listing_agents.includes(name) ? '房源方' : '', d.client_agents.includes(name) ? '客户方' : ''].filter(Boolean).join('、');
    const partners = (arr) => arr.length > 1 ? `，和${arr.filter((n) => n !== name).map(esc).join('、')}平分` : '';
    return { mine, html: `<div class="card stack" style="gap:6px">
      <div class="row" style="gap:10px"><span class="tc tt-${{ '二手买卖': 'a', '租房': 'b', '新房': 'c' }[d.type] || 'a'}">${{ '二手买卖': '二手', '租房': '租房', '新房': '新房' }[d.type] || esc(d.type)}</span><b style="font-size:18px">${esc(d.title || '（没写房子）')}</b></div>
      <span class="muted small"><span class="num">${d.deal_date}</span>${[d.type !== '新房' && d.owner_name ? '房东：' + esc(d.owner_name) : '', d.customer_name ? '客户：' + esc(d.customer_name) : ''].filter(Boolean).map((x) => '　' + x).join('')}</span>
      <div class="bd">
        <div class="bd-group">
          ${d.incomes.map((i) => `<span class="sub">${esc(i.type + (i.bank ? '（' + i.bank + '）' : '') + (i.person ? '（' + i.person + '）' : ''))}</span><span class="num sub">${C.fmt(C.toFen(i.amount))}</span>`).join('')}
          ${d.expenses.map((i) => `<span class="sub">减：${esc(i.type)}</span><span class="num sub">-${C.fmt(C.toFen(i.amount))}</span>`).join('')}
          <span class="bd-key">总账</span><span class="num bd-key">${C.fmt(r.net)}</span></div>
        <div class="bd-group">${r.rate ? `<span>减：店面维护 ${r.rate}%</span><span class="num">-${C.fmt(r.maint)}</span>` : '<span class="sub" style="grid-column:1/-1">新房不扣店面维护</span>'}
          <span class="bd-key">纯利润</span><span class="num bd-key">${C.fmt(r.rest)}</span></div>
        <div class="bd-group">
          ${d.type !== '新房' && d.listing_agents.includes(name) ? `<span>房源方 20% 的业务员一半${partners(d.listing_agents)}</span><span class="num">${C.fmt(r.listingBlock - r.listing.store)}</span>` : ''}
          ${d.client_agents.includes(name) ? `<span>客户方 ${d.type === '新房' ? '100%' : '80%'} 的业务员一半${partners(d.client_agents)}</span><span class="num">${C.fmt(r.clientBlock - r.client.store)}</span>` : ''}
          <span class="bd-key">我这一单（${roles}）</span><span class="num bd-key">${C.fmt(mine)}</span></div>
      </div></div>` };
  }

  async function statement() {
    const st = await S.auntStatement();
    if (!st) return pickName();
    const { name, deals, settlements } = st;
    const pending = deals.filter((x) => x.deal.status === 'confirming' && !(x.confirmation && x.confirmation.status === 'ok'));
    const waitingOthers = deals.filter((x) => x.deal.status === 'confirming' && x.confirmation && x.confirmation.status === 'ok');
    const unsettled = deals.filter((x) => x.deal.status === 'locked' && !x.deal.settlement_id);
    const mineOf = (d) => C.calcDeal(d).people[name] || 0;
    const sumOf = (list) => list.reduce((a, x) => a + mineOf(x.deal), 0);

    const pendingHTML = pending.map((x) => {
      const d = x.deal, c = x.confirmation;
      return `<div class="stack" style="gap:8px">${d.reopen_count ? `<div class="notice">店面改过这一单${d.reopen_note ? '：' + esc(d.reopen_note) : ''}。请重新看一下，没问题再确认。</div>` : ''}${dealCard(d, name).html}
        <button class="btn-primary btn-block" data-ok="${d.id}" style="font-size:20px;min-height:56px">确认无误</button>
        <div class="small muted">有疑问请直接在群里问，没问题再点确认。</div></div>`;
    }).join('<hr style="border:0;border-top:2px dashed var(--line);margin:6px 0">');
    const listRows = (list) => list.map((x) => `<div class="row between"><span><span class="num muted small">${x.deal.deal_date.slice(5)}</span> ${esc(x.deal.title)}</span><b class="num">${C.fmt(mineOf(x.deal))}</b></div>`).join('');
    const stlHTML = settlements.map((s) => {
      const list = deals.filter((x) => x.deal.settlement_id === s.id);
      return `<details class="card settled"><summary class="row between" style="cursor:pointer"><b>${esc(s.name)}</b><b class="num">¥${C.fmt(sumOf(list))}</b></summary>
        <div class="stack" style="gap:4px;margin-top:8px">${listRows(list)}</div></details>`;
    }).join('');

    app.innerHTML = `<div class="wrap stack" style="max-width:560px">
      ${demoBar()}
      <h1>${esc(name)}，您好</h1>
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
      <div class="small muted">规则：每单收入减支出是总账，扣 10% 店面维护后是纯利润（新房不扣）；纯利润房源方 20%、客户方 80%（新房全算客户方）；每一块业务员拿一半，由这一单的业务员平分。</div>
    </div>`;
    bindDemo();
    app.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '确认后不能更改，再点一次'; return; }
      try { await S.auntConfirm(Number(b.dataset.ok), 'ok', ''); statement(); } catch (x) { err(x.message); }
    });
  }

  async function start() {
    try { await statement(); } catch (e) { app.innerHTML = `<div class="wrap"><div class="notice err">打不开：${esc(e.message)}。请检查网络后再试。</div></div>`; }
  }
  start();
})();
