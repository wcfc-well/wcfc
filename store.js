// 数据层：有云数据库配置时用 Supabase，没有时用本机演示数据（localStorage）
// 流程：每一单发给相关业务员确认 → 相关的人都确认后自动锁定 → 每 2-3 个月勾选已确认的单子结算（算钱）
(function () {
  const cfg = window.APP_CONFIG || {};
  const CLOUD = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const TOKEN_KEY = 'ledger_aunt_token';

  const STAFF = ['石文倩', '安丽霞', '李秀英', '周增花', '王海燕', '赵春芹', '马美景', '张建华', '高梅', '吕绪红', '杨业沙', '朱文虎', '翁星宇'];

  // 这一单要确认的人（新房没有房源方）
  const people = (d) => [...new Set([...(d.type === '新房' ? [] : d.listing_agents || []), ...(d.client_agents || [])])];
  const involves = (d, name) => people(d).includes(name);
  const participants = (deals) => [...new Set(deals.flatMap(people))];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 无法保存 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };
  const KEYS = (x) => [x.deal_date, x.type, x.incomes, x.expenses, x.listing_agents, x.client_agents, x.owner_name || '', x.customer_name || ''];
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
          { id: 3, deal_date: '2026-10-20', type: '新房', title: '滨江新城 12 号楼', owner_name: '', customer_name: '黄先生', incomes: [{ type: '开发商佣金', amount: 30000 }], expenses: [{ type: '客户返点', amount: 2000 }], listing_agents: [], client_agents: ['周增花', '李秀英'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
          { id: 4, deal_date: '2026-11-02', type: '二手买卖', title: '和平里 5-1-301', owner_name: '郑先生', customer_name: '何女士', incomes: [{ type: '卖房房东佣金', amount: 25000 }, { type: '卖房客户佣金', amount: 25000 }, { type: '银行返点', amount: 3000, bank: '农行' }], expenses: [{ type: '房东介绍费', amount: 2000, person: '老周' }, { type: '客户维护费', amount: 500, person: '小钱' }], listing_agents: ['石文倩'], client_agents: ['安丽霞', '赵春芹'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
          { id: 5, deal_date: '2026-11-05', type: '租房', title: '春晖苑 2-1203 出租', owner_name: '冯女士', customer_name: '小许', incomes: [{ type: '租房佣金', amount: 4500 }], expenses: [], listing_agents: ['张建华'], client_agents: ['杨业沙'], note: '', status: 'confirming', locked_at: null, settlement_id: null },
        ],
        confirmations: [
          ...okAll(1, ['吕绪红', '王海燕', '李秀英'], '2026-09-14T10:00:00Z'),
          ...okAll(2, ['高梅', '马美景', '翁星宇'], '2026-10-05T10:00:00Z'),
          ...okAll(3, ['周增花'], '2026-10-22T10:00:00Z'),
          ...okAll(4, ['石文倩'], '2026-11-03T10:00:00Z'),
        ],
      };
      save();
    }
    // 演示数据：补上“曹会计”（自动确认，不用手机）
    if (!db.agents.some((x) => x.name === '曹会计')) { db.agents.push({ id: ++db.seq, name: '曹会计', phone4: '', device_token: null, sort: db.agents.length, active: true, auto_confirm: true }); ls.set(KEY, JSON.stringify(db)); }
    function save() { ls.set(KEY, JSON.stringify(db)); }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const deal = (id) => db.deals.find((d) => d.id === id);
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
        const status = send ? 'confirming' : 'draft';
        if (old && (!sameContent(old, d) || status === 'draft')) db.confirmations = db.confirmations.filter((c) => c.deal_id !== old.id);
        const row = { deal_date: d.deal_date, type: d.type, title: d.title, owner_name: d.owner_name || '', customer_name: d.customer_name || '', incomes: clone(d.incomes), expenses: clone(d.expenses), listing_agents: d.listing_agents.slice(), client_agents: d.client_agents.slice(), note: d.note, status };
        let target;
        if (old) target = Object.assign(old, row); else { target = { ...row, id: ++db.seq, locked_at: null, settlement_id: null }; db.deals.push(target); }
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
        db.deals = db.deals.filter((x) => x.id !== id); db.confirmations = db.confirmations.filter((c) => c.deal_id !== id); save();
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
          .map((d) => ({ deal: d, confirmation: db.confirmations.find((c) => c.deal_id === d.id && c.agent_name === a.name) || null }));
        const sids = new Set(deals.map((x) => x.deal.settlement_id).filter(Boolean));
        return clone({ name: a.name, deals, settlements: db.settlements.filter((s) => sids.has(s.id)).sort((x, y) => y.created_at.localeCompare(x.created_at)) });
      },
      async auntConfirm(dealId, status, note) {
        const a = me();
        if (!a) return fail('请重新登记');
        const d = deal(dealId);
        if (!d || d.status !== 'confirming') return fail('这一单现在不能确认');
        db.confirmations = db.confirmations.filter((c) => !(c.deal_id === dealId && c.agent_name === a.name));
        db.confirmations.push({ deal_id: dealId, agent_name: a.name, status, note: note || '', at: new Date().toISOString() });
        maybeLock(d); save();
      },
      demoForget() { const a = me(); if (a) { a.device_token = null; save(); } ls.del(TOKEN_KEY); },
      demoReset() { ls.del(KEY); ls.del(TOKEN_KEY); },
    };
  }

  // ---------- 云数据库 ----------
  function cloudStore() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const cnErr = (m) => {
      if (/Invalid login/i.test(m)) return '邮箱或密码不对';
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return '连不上网络，请检查后再试';
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
        const row = { deal_date: d.deal_date, type: d.type, title: d.title || '', owner_name: d.owner_name || '', customer_name: d.customer_name || '', incomes: d.incomes, expenses: d.expenses, listing_agents: d.listing_agents, client_agents: d.client_agents, note: d.note || '', status: send ? 'confirming' : 'draft' };
        if (d.id) await q(sb.from('deals').update(row).eq('id', d.id)); else await q(sb.from('deals').insert(row));
        return true;
      },
      reopenDeal: (id, reason) => q(sb.rpc('reopen_deal', { p_id: id, p_reason: reason || '' })),
      deleteDeal: (id) => q(sb.from('deals').delete().eq('id', id)),
      listSettlements: () => q(sb.from('settlements').select('*').order('created_at', { ascending: false })),
      createSettlement: (name, ids) => q(sb.rpc('create_settlement', { p_name: name, p_deal_ids: ids })),
      cancelSettlement: (id) => q(sb.from('settlements').delete().eq('id', id)),
      listConfirmations: () => q(sb.from('confirmations').select('*')),

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
      auntConfirm: (id, status, note) => q(sb.rpc('aunt_confirm', { p_token: token(), p_deal: id, p_status: status, p_note: note || '' })),
    };
  }

  if (cfg.supabaseUrl && !window.supabase) {
    // 已经设置了云数据库但没加载成功：绝不能悄悄变成演示模式，不然记的账只存在这台手机上
    document.addEventListener('DOMContentLoaded', () => { document.body.innerHTML = '<div style="padding:24px;font-size:18px">打不开云数据库，请检查网络后刷新页面。</div>'; });
    throw new Error('supabase not loaded');
  }
  window.Store = CLOUD ? cloudStore() : demoStore();
  window.StoreUtil = { involves, participants, people, STAFF };
})();
