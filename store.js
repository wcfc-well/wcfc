// 数据层：有云数据库配置时用 Supabase，没有时用本机演示数据（localStorage）
// 流程：每一单发给相关业务员确认 → 相关的人都确认后自动锁定 → 每 2-3 个月勾选已确认的单子结算（算钱）
(function () {
  const cfg = window.APP_CONFIG || {};
  const CLOUD = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const TOKEN_KEY = 'ledger_aunt_token';

  const STAFF = ['石万倩', '安丽霞', '李秀英', '邹增花', '王海燕', '赵春芹', '马美景', '张建华', '高梅', '吕绪红', '杨业沙', '朱文虎', '翁星宇'];

  // 这一单要确认的人（新房没有房源方）
  const people = (d) => [...new Set([...(d.type === '新房' || d.type === '合作' ? [] : d.listing_agents || []), ...(d.client_agents || [])])];
  const involves = (d, name) => people(d).includes(name);
  const participants = (deals) => [...new Set(deals.flatMap(people))];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 无法保存 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };
  const KEYS = (x) => [x.deal_date, x.type, x.incomes, x.expenses, x.listing_agents, x.client_agents, x.owner_name || '', x.manual || null];  // 客户名字电话不影响分钱，改了不用重新确认
  // 同一套房子的判断：小区去掉空格；坐落里的 幢/栋/号/单元/室/横杠/空格 都当成分隔符。“7幢2单元601” 和 “7-2-601” 算同一套
  const unitKey = (u) => String(u || '').replace(/[\s幢栋号单元室\-—–_/、.，,#]+/g, '-').replace(/^-+|-+$/g, '');
  const houseKey = (x) => String(x.community || '').replace(/\s/g, '') + '|' + unitKey(x.unit);
  // 同一套房子、同一种类型，90 天内只能记一单（防止重复记账多发钱）；新房按楼盘房号比
  const DUP_DAYS = 90;
  const dealKey = (d) => d.parent_id ? null : d.listing_id ? 'L' + d.listing_id + '|' + d.type : d.type === '新房' && (d.title || '').trim() ? 'T' + String(d.title).replace(/[\s幢栋号单元室\-—–_/、.，,#]+/g, '') : null;
  const dupDeal = (d, all) => { const k = dealKey(d); if (!k) return null; const t0 = new Date(d.deal_date).getTime();
    return all.find((y) => y.id !== d.id && dealKey(y) === k && Math.abs(new Date(y.deal_date).getTime() - t0) < DUP_DAYS * 86400000) || null; };
  const sameContent = (a, b) => JSON.stringify(KEYS(a)) === JSON.stringify(KEYS(b));

  // ---------- 演示模式 ----------
  function demoStore() {
    const KEY = 'ledger_demo_v6';
    let db = null;
    try { db = JSON.parse(ls.get(KEY)); } catch (e) { db = null; }
    if (!db) {
      const phones = ['381624', '507293', '916458', '240871', '673105', '158936', '829460', '435712', '062947', '794318', '316580', '587024', '903265'];
      const okAll = (id, names, at) => names.map((n) => ({ deal_id: id, agent_name: n, status: 'ok', note: '', at }));
      db = {
        seq: 100,
        agents: STAFF.map((n, i) => ({ id: i + 1, name: n, phone4: phones[i], device_token: null, sort: i, active: true })),
        settlements: [{ id: 1, name: '10月8日结算（1单）', created_at: '2026-10-08T10:00:00Z' }],
        deals: [
          { id: 1, deal_date: '2026-09-12', type: '二手买卖', title: '幸福小区 3-502', owner_name: '刘先生', customer_name: '陈女士', incomes: [{ type: '卖房房东佣金', amount: 60000 }, { type: '卖房客户佣金', amount: 40000 }], expenses: [{ type: '客户介绍费', amount: 10000, person: '老孙' }], listing_agents: ['吕绪红', '王海燕'], client_agents: ['李秀英'], note: '', status: 'locked', locked_at: '2026-09-14T10:00:00Z', settlement_id: 1 },
          { id: 2, deal_date: '2026-10-03', type: '租房', title: '阳光花园 8-201 出租', owner_name: '赵阿姨', customer_name: '小吴', incomes: [{ type: '租房佣金', amount: 3000 }], expenses: [], listing_agents: ['高梅'], client_agents: ['马美景', '翁星宇'], note: '', status: 'locked', locked_at: '2026-10-05T10:00:00Z', settlement_id: null },
          { id: 3, deal_date: '2026-10-20', type: '新房', title: '滨江新城 12 号楼', owner_name: '', customer_name: '黄先生', incomes: [{ type: '开发商佣金', amount: 30000 }], expenses: [{ type: '客户返点', amount: 2000 }], listing_agents: [], client_agents: ['邹增花', '李秀英'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
          { id: 4, deal_date: '2026-11-02', type: '二手买卖', title: '亭南新村 5幢1单元301', listing_id: 203, owner_name: '郑先生', customer_name: '何女士', incomes: [{ type: '卖房房东佣金', amount: 25000 }, { type: '卖房客户佣金', amount: 25000 }, { type: '银行返点', amount: 3000, bank: '农行' }], expenses: [{ type: '房东介绍费', amount: 2000, person: '老周' }, { type: '客户维护费', amount: 500, person: '小钱' }], listing_agents: ['石万倩'], client_agents: ['安丽霞', '赵春芹'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
          { id: 5, deal_date: '2026-11-05', type: '租房', title: '春晖苑 2-1203 出租', owner_name: '冯女士', customer_name: '小许', incomes: [{ type: '租房佣金', amount: 4500 }], expenses: [], listing_agents: ['张建华'], client_agents: ['杨业沙'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
        ],
        confirmations: [
          ...okAll(1, ['吕绪红', '王海燕', '李秀英'], '2026-09-14T10:00:00Z'),
          ...okAll(2, ['高梅', '马美景', '翁星宇'], '2026-10-05T10:00:00Z'),
          ...okAll(3, ['邹增花'], '2026-10-22T10:00:00Z'),
          ...okAll(4, ['石万倩'], '2026-11-03T10:00:00Z'),
        ],
      };
      save();
    }
    if (!db.listings || db.listingsV !== 3) {
      db.listingsV = 3;
      db.listings = [
        { id: 201, kind: '出售', community: '东亭家园', unit: '7幢2单元601', category: '中户', rooms: 3, halls: 2, elevator: true, layout: '3室2厅', area: 118, decoration: '精装', price: 168, feedback: [{ id: 301, author: '吕绪红', content: '房东说价格可以谈到 160', created_at: '2026-11-01T09:20:00Z' }, { id: 302, author: '王海燕', content: '带客户看过一次，嫌楼层高', created_at: '2026-11-04T14:05:00Z' }], owners: [{ name: '孙先生', phone: '13812345678' }, { name: '孙太太', phone: '13812349999' }], agents: ['吕绪红', '王海燕'], status: 'active', note: '满五唯一，随时看房', note_log: [{ by: '周姐', at: '2026-10-28T10:00:00Z', note: '满五唯一' }, { by: '吕绪红', at: '2026-11-02T16:30:00Z', note: '满五唯一，随时看房' }], created_at: '2026-10-28' },
        { id: 202, kind: '出租', community: '青苑新村三区', unit: '3幢1102', category: '小户', rooms: 2, halls: 1, elevator: true, layout: '2室1厅', area: 86, decoration: '简装', price: 2600, owners: [{ name: '钱阿姨', phone: '13987654321' }], agents: ['高梅'], status: 'active', note: '押一付三，可养宠物', note_log: [{ by: '高梅', at: '2026-11-02T11:00:00Z', note: '押一付三，可养宠物' }], created_at: '2026-11-02' },
        { id: 203, kind: '出售', community: '亭南新村', unit: '5幢1单元301', category: '小户带阁楼', rooms: 2, halls: 1, elevator: false, layout: '2室1厅', area: 72, decoration: '毛坯', price: 95, owners: [{ name: '郑先生', phone: '13700001111' }], agents: ['石万倩'], status: 'done', note: '', created_at: '2026-09-15' },
        { id: 204, kind: '出租', community: '唯亭苑', unit: '18号临街门面', category: '商铺', rooms: null, halls: null, elevator: false, layout: '', area: 45, decoration: '简装', price: 6000, owners: [{ name: '冯老板', phone: '13600002222' }], agents: ['张建华'], status: 'active', note: '可做餐饮', note_log: [{ by: '周姐', at: '2026-11-05T09:30:00Z', note: '可做餐饮' }], created_at: '2026-11-05' },
      ];
      save();
    }
    // 演示数据：周增花 改名 邹增花
    if (JSON.stringify(db).includes('周增花')) { db = JSON.parse(JSON.stringify(db).split('周增花').join('邹增花')); ls.set(KEY, JSON.stringify(db)); }
    // 演示数据：补上“曹会计”（自动确认，不用手机）
    if (!db.agents.some((x) => x.name === '曹会计')) { db.agents.push({ id: ++db.seq, name: '曹会计', phone4: '', device_token: null, sort: db.agents.length, active: true, auto_confirm: true }); ls.set(KEY, JSON.stringify(db)); }
    function save() { ls.set(KEY, JSON.stringify(db)); }
    // 记账和房源连起来：有单子关联就是已售/已租；没有了就变回在售/在租
    function syncListing(lid) {
      if (!lid) return; const l = db.listings.find((y) => y.id === lid); if (!l) return;
      const used = db.deals.some((d) => d.listing_id === lid);
      if (used) l.status = 'done'; else if (l.status === 'done') l.status = 'active';
    }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const deal = (id) => db.deals.find((d) => d.id === id);
    // 客户信息、房东电话轮流填：挑被安排次数最少的人（和 setup.sql 的 pick_filler 一样）
    const pickFiller = (names) => { const auto = new Set(db.agents.filter((g) => g.auto_confirm).map((g) => g.name)); const load = (n) => db.deals.filter((x) => x.cust_owner === n).length + db.listings.filter((x) => x.owner_by === n).length; let best = '', bl = Infinity; (names || []).forEach((n) => { if (auto.has(n)) return; const l = load(n); if (l < bl) { best = n; bl = l; } }); return best; };
    const fixFiller = (row, key, names) => { if (!row[key] || !(names || []).includes(row[key])) row[key] = pickFiller(names); };
    // 房源照片：一套房一张。大图单独存，列表里只带小图
    const setPhoto = (id, photo, thumb) => { db.photos = db.photos || {}; const l = db.listings.find((y) => y.id === id);
      if (photo) { db.photos[id] = photo; if (l) l.photo_thumb = thumb || ''; } else { delete db.photos[id]; if (l) l.photo_thumb = ''; } };
    const ok = (v) => Promise.resolve(clone(v));
    const fail = (m) => Promise.reject(new Error(m));
    const me = () => { const t = ls.get(TOKEN_KEY); return t && db.agents.find((x) => x.device_token === t && x.active); };
    function maybeLock(d) {
      const ps = people(d);
      // 设成“自动确认”的人（例如不会用手机的曹会计）：单子一发出去就替 TA 确认
      if (d.status === 'confirming') ps.filter((n) => db.agents.some((a) => a.name === n && a.auto_confirm) && !db.confirmations.some((c) => c.deal_id === d.id && c.agent_name === n))
        .forEach((n) => db.confirmations.push({ deal_id: d.id, agent_name: n, status: 'ok', note: '自动确认', at: new Date().toISOString() }));
      if (d.status === 'confirming' && ps.length && ps.every((n) => db.confirmations.some((c) => c.deal_id === d.id && c.agent_name === n && c.status === 'ok'))) {
        d.status = 'locked'; d.locked_at = new Date().toISOString();
      }
    }

    return {
      mode: 'demo',
      async session() { return { email: 'demo' }; },
      async login() { return true; },
      async logout() {},
      listAgents: () => ok(db.agents.slice().sort((a, b) => a.sort - b.sort)),
      async saveAgent(a) {
        if (db.agents.some((x) => x.name === a.name && x.id !== a.id)) return fail('名字重复了');
        if (a.id) Object.assign(db.agents.find((x) => x.id === a.id), { name: a.name, phone4: a.phone4, active: a.active, auto_confirm: !!a.auto_confirm });
        if (a.auto_confirm) db.deals.filter((d) => d.status === 'confirming').forEach(maybeLock);  // 后来设成自动确认：以前等确认的单子也替 TA 确认
        else db.agents.push({ name: a.name, phone4: a.phone4 || '', id: ++db.seq, device_token: null, sort: db.agents.length, active: true });
        save(); return true;
      },
      async resetBinding(id) { Object.assign(db.agents.find((x) => x.id === id), { device_token: null, fail_count: 0 }); save(); },
      async setCode(id, code) { Object.assign(db.agents.find((x) => x.id === id), { phone4: code, device_token: null, fail_count: 0 }); save(); },
      listDeals: () => ok(db.deals.slice().sort((a, b) => (b.deal_date + String(b.id).padStart(8, '0')).localeCompare(a.deal_date + String(a.id).padStart(8, '0')))),
      // send=true：保存并发给业务员确认；false：保存为草稿
      async saveDeal(d, send) {
        const old = d.id ? deal(d.id) : null;
        if (old && old.status === 'locked') return fail('这一单大家已经确认锁定，不能再改');
        if (!old) { const tw = dupDeal(d, db.deals); if (tw) return fail(`这套房子 ${DUP_DAYS} 天内已经记过一单（${tw.deal_date}），不能重复记账`); }
        const status = send ? 'confirming' : 'draft';
        if (old && (!sameContent(old, d) || status === 'draft')) db.confirmations = db.confirmations.filter((c) => c.deal_id !== old.id);
        const row = { deal_date: d.deal_date, type: d.type, title: d.title, owner_name: d.owner_name || '', partner: d.partner || '', customer_phone: d.customer_phone || '', customer_name: d.customer_name || '', incomes: clone(d.incomes), expenses: clone(d.expenses), listing_agents: d.listing_agents.slice(), client_agents: d.client_agents.slice(), manual: d.manual ? clone(d.manual) : null, note: d.note, status, listing_id: d.listing_id || null, parent_id: d.parent_id || null, deal_price: d.deal_price == null || d.deal_price === '' ? null : Number(d.deal_price) };
        const oldL = old ? old.listing_id : null;
        let target;
        if (old) target = Object.assign(old, row); else { target = { ...row, id: ++db.seq, locked_at: null, settlement_id: null }; db.deals.push(target); }
        if (target.parent_id) target.cust_owner = ''; else fixFiller(target, 'cust_owner', target.client_agents);
        syncListing(oldL); syncListing(target.listing_id, null);
        maybeLock(target); save(); return true;
      },
      // 已确认锁定、还没结算的单子发现算错：撤回重改，确认作废，业务员要重新确认
      async reopenDeal(id, reason) {
        const d = deal(id);
        if (!d || d.status !== 'locked') return fail('这一单没有锁定，直接改就行');
        if (d.settlement_id) return fail('这一单已经结算了，请先在“结算记录”里撤销这次结算');
        d.status = 'confirming'; d.locked_at = null; d.reopen_note = reason || ''; d.reopen_count = (d.reopen_count || 0) + 1;
        db.confirmations = db.confirmations.filter((c) => c.deal_id !== id); maybeLock(d); save(); return true;
      },
      async deleteDeal(id) {
        if (deal(id).status === 'locked') return fail('这一单大家已经确认锁定，不能删除');
        const lid = deal(id).listing_id;
        db.deals = db.deals.filter((x) => x.id !== id); syncListing(lid, null); db.confirmations = db.confirmations.filter((c) => c.deal_id !== id); save();
      },
      listSettlements: () => ok(db.settlements.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))),
      async createSettlement(name, ids) {
        if (ids.some((id) => deal(id).settlement_id || deal(id).status !== 'locked')) return fail('只能结算已经确认、还没结算的单子，请刷新');
        const s = { id: ++db.seq, name, created_at: new Date().toISOString() };
        db.settlements.push(s); ids.forEach((id) => { deal(id).settlement_id = s.id; }); save(); return s.id;
      },
      async cancelSettlement(id) {
        db.deals.forEach((d) => { if (d.settlement_id === id) d.settlement_id = null; });
        db.settlements = db.settlements.filter((s) => s.id !== id); save();
      },
      listConfirmations: () => ok(db.confirmations),

      // 业务员端
      auntNames: () => ok(db.agents.filter((a) => a.active && !a.auto_confirm).map((a) => ({ name: a.name, bound: !!a.device_token }))),
      async auntBind(name, phone4) {
        const a = db.agents.find((x) => x.name === name && x.active);
        if (!a) return fail('找不到这个名字');
        if ((a.fail_count || 0) >= 5) return fail('密码输错太多次，已经锁住了，请找店面解锁');
        if (!a.phone4 || a.phone4 !== phone4) { a.fail_count = (a.fail_count || 0) + 1; save(); return fail(a.fail_count >= 5 ? '密码输错太多次，已经锁住了，请找店面解锁' : `密码不对，还能再试 ${5 - a.fail_count} 次`); }
        a.fail_count = 0;
        a.device_token = uuid(); save(); ls.set(TOKEN_KEY, a.device_token); return a.device_token;
      },
      async auntStatement() {
        const a = me();
        if (!a) { ls.del(TOKEN_KEY); return null; }
        const deals = db.deals.filter((d) => d.status !== 'draft' && involves(d, a.name))
          .sort((x, y) => (y.deal_date + y.id).localeCompare(x.deal_date + x.id))
          .map((d) => ({ deal: d, confirmation: db.confirmations.find((c) => c.deal_id === d.id && c.agent_name === a.name) || null,
            waiting: people(d).filter((n) => !db.confirmations.some((c) => c.deal_id === d.id && c.agent_name === n && c.status === 'ok')) }));
        const sids = new Set(deals.map((x) => x.deal.settlement_id).filter(Boolean));
        const nudge = (db.nudges || []).filter((n) => n.agent_name === a.name && !n.seen_at).sort((x, y) => y.created_at.localeCompare(x.created_at))[0] || null;
        return clone({ name: a.name, deals, nudge, settlements: db.settlements.filter((s) => sids.has(s.id)).sort((x, y) => y.created_at.localeCompare(x.created_at)) });
      },
      async auntNudgeSeen() { const a = me(); if (!a) return; (db.nudges || []).forEach((n) => { if (n.agent_name === a.name && !n.seen_at) n.seen_at = new Date().toISOString(); }); save(); },
      listNudges: () => ok((db.nudges || []).slice().sort((x, y) => y.created_at.localeCompare(x.created_at))),
      async nudge(names) { db.nudges = db.nudges || []; names.forEach((n) => db.nudges.push({ id: ++db.seq, agent_name: n, created_at: new Date().toISOString(), seen_at: null })); save(); },
      async auntConfirm(dealId, status, note, cust) {
        const a = me();
        if (!a) return fail('请重新登记');
        const d = deal(dealId);
        if (!d || d.status !== 'confirming') return fail('这一单现在不能确认');
        if (status === 'ok' && !d.parent_id && (d.cust_owner ? d.cust_owner === a.name : (d.client_agents || []).includes(a.name))) {
          const cn = (cust && cust.name || '').trim() || d.customer_name || '', cp = (cust && cust.phone || '').trim() || d.customer_phone || '';
          if (!cn) return fail('这一单的客户信息轮到您填，请先填客户名字');
          if (cp.replace(/\D/g, '').length < 7) return fail('这一单的客户信息轮到您填，请先填客户电话');
          if (cn !== d.customer_name || cp !== d.customer_phone) { d.customer_name = cn; d.customer_phone = cp; d.customer_by = a.name; d.customer_at = new Date().toISOString(); }
        }
        db.confirmations = db.confirmations.filter((c) => !(c.deal_id === dealId && c.agent_name === a.name));
        db.confirmations.push({ deal_id: dealId, agent_name: a.name, status, note: note || '', at: new Date().toISOString() });
        maybeLock(d); save();
      },
      demoForget() { const a = me(); if (a) { a.device_token = null; save(); } ls.del(TOKEN_KEY); },
      listingPhoto: async (id) => (db.photos || {})[id] || '',
      auntListingPhoto: async (id) => (me() ? (db.photos || {})[id] || '' : fail('请重新登记')),
      listListings: () => ok(db.listings.slice().sort((a, b) => (b.created_at + String(b.id).padStart(8, '0')).localeCompare(a.created_at + String(a.id).padStart(8, '0')))),
      async saveListing(x) {
        x = { ...x }; const ph = 'photo' in x ? x.photo : undefined; delete x.photo;
        const dup = db.listings.find((y) => y.id !== x.id && houseKey(y) === houseKey(x));
        if (dup) return fail(`系统里已经有这套房子了（${dup.community} ${dup.unit}，维护人 ${(dup.agents || []).join('、') || '—'}），不能重复录入`);
        const old = x.id && db.listings.find((y) => y.id === x.id);
        let id = x.id;
        if (id) { Object.assign(old, x); fixFiller(old, 'owner_by', old.agents); }
        else { id = ++db.seq; const nl = { ...x, id, created_at: x.created_at || new Date().toISOString().slice(0, 10) }; fixFiller(nl, 'owner_by', nl.agents); db.listings.push(nl); }
        if (ph !== undefined) setPhoto(id, ph, x.photo_thumb);
        save(); return id;
      },
      async deleteListing(id) { db.listings = db.listings.filter((y) => y.id !== id); save(); },
      async addFeedback(id, author, content) { const l = db.listings.find((y) => y.id === id); (l.feedback = l.feedback || []).push({ id: ++db.seq, author, content, created_at: new Date().toISOString() }); save(); },
      async auntListings() { const a = me(); if (!a) return null; return clone(db.listings.filter((l) => l.status !== 'off').map((l) => ({ ...l, mine: (l.agents || []).includes(a.name), feedback: l.feedback || [], deal_price: (db.deals.filter((d) => d.listing_id === l.id && !d.parent_id && d.deal_price != null).sort((x, y) => y.deal_date.localeCompare(x.deal_date))[0] || {}).deal_price ?? null }))); },
      async auntListingNote(id, note) { const a = me(); if (!a) return fail('请重新登记'); const l = db.listings.find((y) => y.id === id); if ((l.note || '') === note) return; const at = new Date().toISOString(); Object.assign(l, { note, note_by: a.name, note_at: at, note_log: [...(l.note_log || []), { by: a.name, at, note }] }); save(); },
      async auntListingFeedback(id, content) { const a = me(); if (!a) return fail('请重新登记'); if (!content.trim()) return fail('反馈内容不能是空的'); const l = db.listings.find((y) => y.id === id); (l.feedback = l.feedback || []).push({ id: ++db.seq, author: a.name, content: content.trim(), created_at: new Date().toISOString() }); save(); },
      async auntListingSave(id, x) {
        const a = me(); if (!a) return fail('请重新登记');
        if (!x.community && x.category !== '商铺') return fail('请选小区'); if (!x.unit) return fail('请填坐落');
        const dup = db.listings.find((y) => y.id !== id && houseKey(y) === houseKey(x));
        if (dup) return fail('系统里已经有这套房子了，不能重复录入');
        const num = (v) => v === '' || v == null ? null : Number(v);
        const d = { kind: x.kind, community: x.community, unit: x.unit, category: x.category || '', rooms: num(x.rooms), halls: num(x.halls), area: num(x.area), price: num(x.price), elevator: !!x.elevator, decoration: x.decoration || '', school: x.school || '', years: x.years || '', owners: x.owners || [], updated_by: a.name };
        if (!id) {
          const names = db.agents.filter((g) => g.active).map((g) => g.name);
          const ags = (x.agents || []).filter((n) => names.includes(n));
          const nid = ++db.seq, at = new Date().toISOString();
          const nl = { ...d, id: nid, agents: ags.length ? ags : [a.name], status: 'active', note: x.note || '', note_log: x.note ? [{ by: a.name, at, note: x.note }] : [], created_by: a.name, created_at: at.slice(0, 10), feedback: [] };
          fixFiller(nl, 'owner_by', nl.agents); db.listings.push(nl);
          if ('photo' in x) setPhoto(nid, x.photo, x.photo_thumb);
          save(); return nid;
        }
        const l = db.listings.find((y) => y.id === id); if (!l) return fail('找不到这套房源');
        const filled = !!(d.category || d.area);
        if (l.needs_info && filled) Object.assign(d, { needs_info: false, filled_by: a.name, filled_at: new Date().toISOString() });
        if (!(l.agents || []).includes(a.name)) d.owners = l.owners || [];  // 房东信息只有房源维护人和店面能改
        Object.assign(l, d); if ('photo' in x) setPhoto(id, x.photo, x.photo_thumb); save(); return id;
      },
      // 客户名字、电话：只有店面和这一单的客户方业务员能改，不影响分钱，不作废确认
      async setCustomer(id, name, phone) { const d = deal(id); if (!d) return fail('找不到这一单'); d.customer_name = (name || '').trim(); d.customer_phone = (phone || '').trim(); d.customer_by = '店面'; d.customer_at = new Date().toISOString(); save(); },
      async auntSetCustomer(id, name, phone) {
        const a = me(); if (!a) return fail('请重新登记');
        const d = deal(id); if (!d || !(d.client_agents || []).includes(a.name)) return fail('只有这一单的客户方业务员能改客户信息');
        if (!(name || '').trim()) return fail('请填客户名字'); if ((phone || '').replace(/\D/g, '').length < 7) return fail('请填正确的客户电话');
        d.customer_name = name.trim(); d.customer_phone = phone.trim(); d.customer_by = a.name; d.customer_at = new Date().toISOString(); save();
      },
      demoReset() { ls.del(KEY); ls.del(TOKEN_KEY); },
    };
  }

  // ---------- 云数据库 ----------
  function cloudStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const cnErr = (m) => {
      if (/Invalid login/i.test(m)) return '邮箱或密码不对';
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '连不上网络，请检查后再试';
      if (/listings_same_house/.test(m)) return '系统里已经有这套房子了（小区和坐落都一样），不能重复录入';
      return m;
    };
    const q = async (p) => { const { data, error } = await p; if (error) throw new Error(cnErr(error.message)); return data; };
    const token = () => ls.get(TOKEN_KEY);
    return {
      mode: 'cloud',
      async session() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
      async login(email, pw) { await q(sb.auth.signInWithPassword({ email, password: pw })); return true; },
      async logout() { await sb.auth.signOut(); },
      listAgents: () => q(sb.from('agents').select('*').order('sort').order('id')),
      // 手机下载：先传到云端 exports 文件夹，返回一个 7 天有效的下载链接（安卓自带浏览器也能下）
      async uploadExport(blob, fname) {
        const ext = (fname.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '');
        const id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
        const path = `${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
        const bucket = sb.storage.from('exports');
        const up = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
        if (up.error) throw new Error(cnErr(up.error.message));
        const [d, v] = await Promise.all([bucket.createSignedUrl(path, 7 * 24 * 3600, { download: fname }), bucket.createSignedUrl(path, 7 * 24 * 3600)]);
        if (d.error || v.error) throw new Error(cnErr((d.error || v.error).message));
        // download：点了直接下载；view：在微信里点开直接看，长按图片可以保存或转发
        return { download: d.data.signedUrl, view: v.data.signedUrl };
      },
      async saveAgent(a) {
        const row = { name: a.name, phone4: a.phone4 || '', active: a.active !== false, auto_confirm: !!a.auto_confirm };
        if (a.id) await q(sb.from('agents').update(row).eq('id', a.id));
        else { const list = await q(sb.from('agents').select('id')); await q(sb.from('agents').insert({ ...row, sort: list.length })); }
        return true;
      },
      resetBinding: (id) => q(sb.from('agents').update({ device_token: null, fail_count: 0 }).eq('id', id)),
      setCode: (id, code) => q(sb.from('agents').update({ phone4: code, device_token: null, fail_count: 0 }).eq('id', id)),
      listDeals: () => q(sb.from('deals').select('*').order('deal_date', { ascending: false }).order('id', { ascending: false })),
      async saveDeal(d, send) {
        const row = { deal_date: d.deal_date, type: d.type, title: d.title || '', owner_name: d.owner_name || '', partner: d.partner || '', customer_phone: d.customer_phone || '', customer_name: d.customer_name || '', incomes: d.incomes, expenses: d.expenses, listing_agents: d.listing_agents, client_agents: d.client_agents, manual: d.manual || null, note: d.note || '', status: send ? 'confirming' : 'draft', listing_id: d.listing_id || null, parent_id: d.parent_id || null, deal_price: d.deal_price == null || d.deal_price === '' ? null : Number(d.deal_price) };
        if (d.id) await q(sb.from('deals').update(row).eq('id', d.id)); else await q(sb.from('deals').insert(row));
        return true;
      },
      reopenDeal: (id, reason) => q(sb.rpc('reopen_deal', { p_id: id, p_reason: reason || '' })),
      deleteDeal: (id) => q(sb.from('deals').delete().eq('id', id)),
      listSettlements: () => q(sb.from('settlements').select('*').order('created_at', { ascending: false })),
      async listListings() {
        const r = await q(sb.from('listings').select('*, feedback:listing_feedback(*)').order('created_at', { ascending: false }).order('id', { ascending: false }));
        r.forEach((l) => l.feedback.sort((a, b) => a.created_at.localeCompare(b.created_at))); return r;
      },
      addFeedback: (id, author, content) => q(sb.from('listing_feedback').insert({ listing_id: id, author, content })),
      auntListings: () => token() ? q(sb.rpc('aunt_listings', { p_token: token() })) : Promise.resolve(null),
      auntListingNote: (id, note) => q(sb.rpc('aunt_listing_note', { p_token: token(), p_id: id, p_note: note })),
      auntListingSave: (id, x) => q(sb.rpc('aunt_listing_save', { p_token: token(), p_id: id || null, p: x })),
      auntListingFeedback: (id, content) => q(sb.rpc('aunt_listing_feedback', { p_token: token(), p_id: id, p_content: content })),
      async saveListing(x) {
        const row = { ...x }; delete row.id; delete row.feedback; delete row.photo; delete row.photo_thumb;
        let id = x.id;
        if (id) await q(sb.from('listings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id));
        else id = (await q(sb.from('listings').insert(row).select('id').single())).id;  // 返回新房源的编号，记账自动建房源时要用
        if ('photo' in x) await q(sb.rpc('listing_set_photo', { p_id: id, p: { photo: x.photo || '', photo_thumb: x.photo_thumb || '' } }));
        return id;
      },
      listingPhoto: async (id) => { const r = await q(sb.from('listing_photos').select('data').eq('listing_id', id).maybeSingle()); return r ? r.data : ''; },
      auntListingPhoto: (id) => q(sb.rpc('aunt_listing_photo', { p_token: token(), p_id: id })),
      deleteListing: (id) => q(sb.from('listings').delete().eq('id', id)),
      createSettlement: (name, ids) => q(sb.rpc('create_settlement', { p_name: name, p_deal_ids: ids })),
      cancelSettlement: (id) => q(sb.from('settlements').delete().eq('id', id)),
      listConfirmations: () => q(sb.from('confirmations').select('*')),
      // 催办：店面点“催一下”，业务员下次打开页面会弹出提醒
      listNudges: () => q(sb.from('nudges').select('*').order('created_at', { ascending: false }).limit(300)),
      nudge: (names) => q(sb.from('nudges').insert(names.map((n) => ({ agent_name: n })))),
      auntNudgeSeen: () => q(sb.rpc('aunt_nudge_seen', { p_token: token() })),
      // 锁屏通知：业务员登记这台手机；店面催办时让云端发通知
      auntPushSubscribe: (s) => q(sb.rpc('aunt_push_subscribe', { p_token: token(), p_endpoint: s.endpoint, p_p256dh: s.keys.p256dh, p_auth: s.keys.auth })),
      listPushSubs: () => q(sb.from('push_subs').select('agent_name, created_at')),
      async pushNudge(items) { const r = await sb.functions.invoke('push', { body: { items } }); if (r.error) throw new Error('锁屏通知没发出去'); return r.data; },

      auntNames: () => q(sb.rpc('aunt_names')),
      async auntBind(name, phone4) {
        const t = await q(sb.rpc('aunt_bind', { p_name: name, p_phone4: phone4 }));
        if (!t || String(t).startsWith('ERR:')) throw new Error(t ? String(t).slice(4) : '登记失败，请再试一次');
        ls.set(TOKEN_KEY, t); return t;
      },
      async auntStatement() {
        if (!token()) return null;
        const r = await q(sb.rpc('aunt_statement', { p_token: token() }));
        if (!r) { ls.del(TOKEN_KEY); return null; }
        return r;
      },
      setCustomer: (id, name, phone) => q(sb.from('deals').update({ customer_name: (name || '').trim(), customer_phone: (phone || '').trim() }).eq('id', id)),
      auntSetCustomer: (id, name, phone) => q(sb.rpc('aunt_set_customer', { p_token: token(), p_deal: id, p_name: name, p_phone: phone })),
      auntConfirm: (id, status, note, cust) => q(sb.rpc('aunt_confirm', { p_token: token(), p_deal: id, p_status: status, p_note: note || '', p_cust_name: cust ? cust.name : null, p_cust_phone: cust ? cust.phone : null })),
    };
  }

  if (cfg.supabaseUrl && !window.supabase) {
    // 已经设置了云数据库但没加载成功：绝不能悄悄变成演示模式，不然记的账只存在这台手机上
    document.addEventListener('DOMContentLoaded', () => { document.body.innerHTML = '<div style="padding:24px;font-size:18px">打不开云数据库，请检查网络后刷新页面。</div>'; });
    throw new Error('supabase not loaded');
  }
  window.Store = CLOUD ? cloudStore() : demoStore();

  // ---------- 2026-11-16：房源 ⇄ 房源群里那段文字（一键导出、一键导入） ----------
  const CATS_ALL = ['特大户带阁楼', '大户带阁楼', '中户带阁楼', '小户带阁楼', '特大户', '大户', '中户', '小户', '商品房', '商铺'];
  const DECOS = ['毛坯', '简装', '精装', '豪装'];
  const cnNum = (s) => String(s || '').replace(/[一二三四五六七八九十]/g, (c) => '一二三四五六七八九'.indexOf(c) + 1 || 10);
  // 小区名字比较时去掉“新村/花园/家园/小区”、空格，汉字数字换成阿拉伯数字：畅苑三区 = 畅苑新村三区
  const commKey = (s) => cnNum(String(s || '').replace(/\s|新村|花园|家园|小区|社区/g, ''));
  // 小区模糊对：一样、前后包含、或者字按顺序都在（只差一两个字）就算；对上好几个就不算
  const findCommunity = (name, communities) => {
    const k = commKey(name); if (!k) return null;
    const keys = communities.map((c) => [c, commKey(c)]);
    const one = (arr) => arr.length === 1 ? arr[0][0] : arr.length > 1 ? arr.sort((a, b) => a[1].length - b[1].length)[0][0] : null;
    const exact = keys.filter(([, ck]) => ck === k); if (exact.length) return exact[0][0];
    const pre = keys.filter(([, ck]) => ck.startsWith(k) || k.startsWith(ck)); if (pre.length === 1) return pre[0][0];
    const inside = keys.filter(([, ck]) => ck.includes(k) || k.includes(ck)); if (inside.length === 1) return inside[0][0];
    const subseq = (a, b) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };
    const near = keys.filter(([, ck]) => (subseq(k, ck) || subseq(ck, k)) && Math.abs(ck.length - k.length) <= 2 && Math.min(ck.length, k.length) >= 2);
    return near.length === 1 ? near[0][0] : one(pre.length ? pre : []);
  };
  // 商铺位置比较：去掉空格标点和“号/门面/商铺/临街/一楼”这些字，汉字数字换成阿拉伯数字
  const shopKey = (s) => cnNum(String(s || '').toLowerCase().replace(/[\s,，、.。·#\-—–_/()（）:：]|号|门面|商铺|店铺|铺面|临街|沿街|底商|一楼|1楼/g, ''));
  // 和这个商铺位置很像的（不一定一模一样）：一样，或者一个包含另一个
  const similarShops = (unit, list, selfId) => {
    const k = shopKey(unit); if (k.length < 3) return [];
    return list.filter((y) => y.id !== selfId && y.category === '商铺' && (() => { const yk = shopKey(y.unit) + '|' + shopKey(y.community); return yk.split('|').some((p) => p.length >= 3 && (p === k || p.includes(k) || k.includes(p))) || shopKey((y.community || '') + (y.unit || '')).includes(k); })());
  };
  const listingText = (x) => {
    const lay = x.rooms != null && x.rooms !== '' ? `${x.rooms}室${x.halls || 0}厅` : (x.layout || '');
    const price = x.price == null || x.price === '' ? '' : x.kind === '出租' ? `${x.price}元/月` : `${x.price}万`;
    const lines = [
      ['坐落', `${x.community || ''}${x.unit || ''}`],
      [x.kind === '出租' ? '租金' : '价格', price],
      ['面积', x.area ? `${x.area}平` : ''],
      ['户型', [x.category, lay].filter(Boolean).join(' ')],
      ['装修', x.decoration], ['电梯', x.elevator ? '有' : ''],
      ['学区', x.school], ['年限', x.years],
      ['房东', (x.owners || []).map((o) => [o.phone, o.name].filter(Boolean).join('')).filter(Boolean).join('，')],
      ['维护', (x.agents || []).join(' ')],
      ['备注', x.note],
    ];
    return lines.filter(([, v]) => v).map(([k, v]) => `${k}：${v}`).join('\n');
  };
  // 把房源群里的一段文字认成房源。communities：认识的小区；staff：业务员名字（认“安姐、小朱、石”）
  const parseListingText = (text, communities, staff) => {
    const x = { kind: '出售', owners: [], agents: [] }, got = [], miss = [], extraNote = [];
    const pick = {};
    String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/^([一-龥]{2,4})\s*[:：]\s*(.*)$/);
      if (!m) { extraNote.push(line); return; }
      pick[m[1]] = (pick[m[1]] ? pick[m[1]] + ' ' : '') + m[2].trim();
    });
    const take = (...ks) => { for (const k of ks) if (pick[k] != null) { const v = pick[k]; delete pick[k]; return v; } return null; };
    const price = take('价格', '售价', '总价', '租金', '月租');
    if (price) {
      const n = (price.match(/\d+(\.\d+)?/) || [])[0];
      if (/租|月|元/.test(price) && !/万/.test(price)) x.kind = '出租';
      if (n) { x.price = Number(n); got.push('价格'); }
    }
    const area = take('面积');
    if (area) { const n = (area.match(/\d+(\.\d+)?/) || [])[0]; if (n) { x.area = Number(n); got.push('面积'); } }
    const cat = take('户型', '房型');
    if (cat) {
      const c = CATS_ALL.find((t) => cat.includes(t)); if (c) x.category = c;
      const r = cat.match(/(\d|[一二三四五六七])\s*室\s*(?:(\d|[一二三四五六七])\s*厅)?/);
      if (r) { x.rooms = Number(cnNum(r[1])); x.halls = r[2] ? Number(cnNum(r[2])) : 0; }
      if (c || r) got.push('户型'); else extraNote.push('户型：' + cat);
    }
    const addr = take('坐落', '地址', '房源', '小区', '位置');
    if (addr) {
      const shopWords = /路|街|大道|巷|弄|门面|商铺|铺面|店|广场|市场/;
      const isShop = x.category === '商铺' || (!x.category && shopWords.test(addr));
      // 从第一个门牌数字分开：“青苑2区26-1303”里的“2区”算小区名字
      let i = -1; for (const m of addr.matchAll(/\d+/g)) { if (!/^[区期村]/.test(addr.slice(m.index + m[0].length))) { i = m.index; break; } }
      const name = (i < 0 ? addr : addr.slice(0, i)).replace(/[\s,，、]+$/, '').trim();
      const hit = name ? findCommunity(name, communities) : null;
      if (hit && commKey(hit) !== commKey(name)) miss.push(`小区写的是“${name}”，按“${hit}”填了，请核对`);
      if (isShop) {
        x.category = '商铺';
        // 商铺不选小区：整段地址都写在坐落里
        x.community = ''; x.unit = addr.trim(); miss.splice(0, miss.length, ...miss.filter((m) => !m.startsWith('小区写的是')));
        got.push('坐落（商铺）');
      } else {
        x.unit = i < 0 ? '' : addr.slice(i).trim();
        x.community = hit || name; x.commKnown = !!hit;
        got.push('坐落'); if (!hit && name) miss.push(`小区“${name}”不在列表里，已放进“其他”`);
      }
    }
    const deco = take('装修');
    if (deco) { const d = DECOS.find((t) => deco.includes(t)); if (d) { x.decoration = d; got.push('装修'); } const rest = deco.replace(d || '', '').trim(); if (rest) extraNote.push('装修：' + rest); }
    const elev = take('电梯');
    if (elev) { x.elevator = /有|是|带/.test(elev) && !/无|没/.test(elev); got.push('电梯'); }
    const school = take('学区');
    if (school) { x.school = /无|没|否/.test(school) ? '无' : /有|是/.test(school) ? '有' : school; got.push('学区'); }
    const years = take('年限', '产证', '满几年');
    if (years) { x.years = years.replace(/\s/g, '').replace(/年/g, ''); got.push('年限'); }
    const owner = take('房东', '业主', '联系');
    if (owner) {
      const phones = owner.match(/1\d{10}|\d{7,8}/g) || [];
      const name = owner.replace(/1\d{10}|\d{7,8}/g, ' ').replace(/[,，、;；/]+/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (phones.length) phones.forEach((p, i) => x.owners.push({ name: name[i] || (i === 0 ? name.join('') : ''), phone: p }));
      else if (name.length) x.owners.push({ name: name.join(' '), phone: '' });
      got.push('房东');
    }
    const keep = take('维护', '维护人', '业务员', '负责');
    if (keep) {
      keep.split(/[\s,，、/和&]+/).filter(Boolean).forEach((t) => {
        const exact = staff.find((n) => n === t);
        const core = t.replace(/^[小老阿]/, '').replace(/[姐哥总妹弟]$/, '');
        const cand = exact ? [exact] : core ? staff.filter((n) => n[0] === core[0] && (core.length === 1 || n.includes(core))) : [];
        const byGiven = !cand.length && core ? staff.filter((n) => n.slice(1).includes(core)) : [];
        const c = cand.length ? cand : byGiven;
        if (c.length === 1) { if (!x.agents.includes(c[0])) x.agents.push(c[0]); } else miss.push(`维护人“${t}”${c.length ? '对上好几个人' : '没认出来'}，请手动点`);
      });
      if (x.agents.length) got.push('维护人');
    }
    const note = take('备注', '说明', '其他');
    Object.entries(pick).forEach(([k, v]) => extraNote.push(`${k}：${v}`));
    x.note = [note, ...extraNote].filter(Boolean).join('；');
    if (x.note) got.push('备注');
    return { x, got, miss };
  };
  window.StoreUtil = { listingText, parseListingText, commKey, findCommunity, shopKey, similarShops, involves, participants, people, STAFF, houseKey, unitKey, dealKey, dupDeal, DUP_DAYS };

  // 房源照片：手机选一张，压缩成大图（最长 1280）和小图（最长 320），都是 jpg
  function resizeTo(img, max, q) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  function loadImage(file) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image();
      i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('这张照片打不开，请换一张')); }; i.src = u; });
  }
  const Photo = window.Photo = {
    async fromFile(file) {
      if (!file) return null;
      const img = await loadImage(file);
      let photo = resizeTo(img, 1280, 0.78); if (photo.length > 1500000) photo = resizeTo(img, 1000, 0.65);
      return { photo, photo_thumb: resizeTo(img, 640, 0.68) };
    },
    // 录入 / 修改房源时的照片框。返回 changed()：undefined = 没动；null = 删掉了；{photo, photo_thumb} = 新照片
    field(box, thumb, getFull) {
      let cur = thumb || '', change;
      const draw = () => {
        box.innerHTML = `<span class="small muted">房子照片（1 张，点照片可以放大）</span>
          ${cur ? `<img class="ph-prev" src="${cur}" alt="房子照片">` : ''}
          <div class="row" style="gap:8px"><label class="ph-pick"><input type="file" accept="image/*" hidden>${cur ? '换一张' : '📷 加一张照片'}</label>${cur ? '<button type="button" class="ph-del">删掉照片</button>' : ''}</div>
          <div class="small muted ph-msg"></div>`;
        const img = box.querySelector('.ph-prev'); if (img) img.onclick = () => Photo.show(change ? change.photo : getFull());
        box.querySelector('input[type=file]').onchange = async (e) => {
          const msg = box.querySelector('.ph-msg'); msg.textContent = '正在处理照片…';
          try { const r = await Photo.fromFile(e.target.files[0]); if (!r) { msg.textContent = ''; return; } change = r; cur = r.photo_thumb; draw(); box.querySelector('.ph-msg').textContent = '保存后生效'; }
          catch (x) { msg.textContent = x.message; }
        };
        const del = box.querySelector('.ph-del'); if (del) del.onclick = () => { change = null; cur = ''; draw(); box.querySelector('.ph-msg').textContent = '保存后照片就删掉了'; };
      };
      draw();
      return { changed: () => change };
    },
    // 点了放大：黑底全屏，点哪里都关
    show(src) {
      const ov = document.createElement('div'); ov.className = 'lightbox'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '房子照片');
      ov.innerHTML = '<div class="lb-tip">加载中…</div><button type="button" class="lb-x" aria-label="关闭">×</button>';
      document.body.appendChild(ov); ov.onclick = () => ov.remove();
      Promise.resolve(src).then((u) => { if (!u) { ov.querySelector('.lb-tip').textContent = '没有照片'; return; } const i = new Image(); i.alt = '房子照片'; i.src = u; ov.querySelector('.lb-tip').replaceWith(i); })
        .catch(() => { ov.querySelector('.lb-tip').textContent = '照片打不开，请检查网络'; });
    },
  };
})();
