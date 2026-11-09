// 分账算法（所有金额用“分”为单位的整数计算，避免小数误差）
// 规则：
//   每一单：净额 = 收入合计 − 支出合计
//   店面维护成本 = （佣金 − 支出）× 10%，银行返点等其他收入不扣（新房没有这一项）
//   剩余 = 净额 − 店面维护成本
//   佣金部分的纯利润：二手/租房 房源方 20%，客户方 80%；新房：没有房源方，100% 客户方
//   返点不扣 10%，也不按 20/80 分，直接归一方：银行返点、装修返点 → 客户方；垫资返点 → 房源方；
//   其他收入看记账时选的（side: 'listing' 房源方 / 'client' 客户方，默认客户方）。新房只有客户方
//   每一块：店面拿一半，业务员一半由这一块的业务员平分
//   零头：店面那部分向下取整到分，多出来的分归业务员（按名单顺序逐个多给 1 分）
//   支出里标了“某业务员垫付”的，照样从总账里扣，结算时再把这笔钱加给垫付的人

(function (root) {
  const INCOME_TYPES = ['卖房房东佣金', '卖房客户佣金', '租房佣金', '开发商佣金', '银行返点', '装修返点', '垫资返点', '其他收入'];
  const EXPENSE_TYPES = ['客户介绍费', '房东介绍费', '客户维护费', '房东维护费', '客户返点', '税费', '其他支出'];
  // 每种房屋类型的支出：新房没有房东的两项
  const EXPENSE_BY_TYPE = {
    '二手买卖': ['客户介绍费', '房东介绍费', '客户维护费', '房东维护费', '客户返点', '税费', '其他支出'],
    '租房': ['客户介绍费', '房东介绍费', '客户维护费', '房东维护费', '客户返点', '税费', '其他支出'],
    '新房': ['客户介绍费', '客户维护费', '客户返点', '税费', '其他支出'],
    '合作': ['客户介绍费', '房东介绍费', '客户维护费', '房东维护费', '客户返点', '税费', '其他支出'],
  };
  // 固定拿钱的人：只要这一单选了 TA（房源方、客户方都算，两边都选也只算一次），TA 固定拿这么多，当成本先扣，不参加对半分（2026-11-09）
  const FIXED_PAY = { '曹会计': 500 };
  const MAINT_RATE = { '二手买卖': 10, '租房': 10, '新房': 0, '合作': 0 };
  // 只有佣金扣店面维护成本；银行返点、装修返点、垫资返点、其他收入都不扣
  const COMMISSION_TYPES = ['卖房房东佣金', '卖房客户佣金', '租房佣金', '开发商佣金', '合作总佣金'];
  const DEAL_TYPES = ['二手买卖', '租房', '新房', '合作'];
  // 合作：和别的中介合作，总佣金对半分。我们这一半不分房源方客户方，店面一半、这一单的业务员平分一半（不扣 10%）
  const oneSide = (t) => t === '新房' || t === '合作';
  // 每种房屋类型对应的佣金；返点和其他收入所有类型都可能有
  const COMMON_INCOME = ['银行返点', '装修返点', '垫资返点', '其他收入'];
  const INCOME_BY_TYPE = {
    '二手买卖': ['卖房房东佣金', '卖房客户佣金', ...COMMON_INCOME],
    '租房': ['租房佣金', ...COMMON_INCOME],
    '新房': ['开发商佣金', ...COMMON_INCOME],
    '合作': ['合作总佣金', ...COMMON_INCOME],   // 返点、其他收入不给合作中介，店面和这一单业务员分
  };
  const STORE = '店面';
  // 返点归哪一方
  const RETURN_SIDE = { '银行返点': 'client', '装修返点': 'client', '垫资返点': 'listing' };
  const sideOf = (it, isNew) => isNew ? 'client' : RETURN_SIDE[it.type] || (it.side === 'listing' ? 'listing' : 'client');

  const toFen = (yuan) => Math.round(Number(yuan || 0) * 100);
  const fmt = (fen) => {
    const neg = fen < 0; fen = Math.abs(fen);
    const s = (Math.floor(fen / 100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(fen % 100).padStart(2, '0');
    return (neg ? '-' : '') + s;
  };
  const sum = (items) => (items || []).reduce((a, it) => a + toFen(it.amount), 0);

  // 把一块钱（分）分给店面和业务员
  function splitBlock(blockFen, agents) {
    const out = { store: 0, agents: {} };
    if (blockFen === 0) return out;
    if (!agents || agents.length === 0) { out.store = blockFen; out.noAgents = blockFen > 0; return out; }
    const storeHalf = Math.floor(blockFen / 2);
    const pool = blockFen - storeHalf;
    const each = Math.floor(pool / agents.length);
    let extra = pool - each * agents.length;
    out.store = storeHalf;
    agents.forEach((a) => { out.agents[a] = (out.agents[a] || 0) + each + (extra > 0 ? 1 : 0); if (extra > 0) extra--; });
    return out;
  }

  // 这一单里固定拿钱的人：{名字: 分}。补记返点、疑难单（周姐自己填）不算
  const fixedOf = (deal) => {
    if (deal.parent_id || deal.manual) return {};
    const inDeal = [...(oneSide(deal.type) ? [] : deal.listing_agents || []), ...(deal.client_agents || [])];
    const out = {}; Object.entries(FIXED_PAY).forEach(([n, y]) => { if (inDeal.includes(n)) out[n] = toFen(y); });
    return out;
  };
  // 计算一单
  function calcDeal(deal) {
    const income = sum(deal.incomes);
    const fixed = fixedOf(deal), fixedTotal = Object.values(fixed).reduce((a, b) => a + b, 0);
    const expense = sum(deal.expenses) + fixedTotal;          // 固定拿钱的算在支出（成本）里
    const isCoop = deal.type === '合作';
    const coopTotal = isCoop ? sum((deal.incomes || []).filter((i) => i.type === '合作总佣金')) : 0;
    const partnerCut = Math.floor(coopTotal / 2);             // 合作中介拿走的一半
    const net = income - partnerCut - expense;
    const rate = MAINT_RATE[deal.type] == null ? 10 : MAINT_RATE[deal.type];
    const commission = sum((deal.incomes || []).filter((i) => COMMISSION_TYPES.includes(i.type)));
    const otherIncome = income - commission;
    const maintBase = Math.max(0, commission - expense);     // 新房、合作的比例是 0，这里算了也不扣     // 佣金减去支出后的部分才扣 10%
    const maint = Math.floor(maintBase * rate / 100);
    const rest = net - maint;
    const isNew = oneSide(deal.type);
    const profit = commission - partnerCut - expense - maint;               // 佣金部分的纯利润，按 20/80 分
    const listingPct = isNew ? 0 : 20;
    const listingProfit = Math.floor(profit * listingPct / 100);
    const clientProfit = profit - listingProfit;
    const returns = { listing: [], client: [] };               // 返点直接归一方：[{type, fen}]
    (deal.incomes || []).filter((i) => !COMMISSION_TYPES.includes(i.type)).forEach((i) => {
      const fen = toFen(i.amount); if (fen) returns[sideOf(i, isNew)].push({ type: i.type, fen, bank: i.bank || '' });
    });
    const listingReturn = returns.listing.reduce((a, x) => a + x.fen, 0);
    const clientReturn = returns.client.reduce((a, x) => a + x.fen, 0);
    const listingBlock = listingProfit + listingReturn;
    const clientBlock = clientProfit + clientReturn;
    const noFixed = (arr) => (arr || []).filter((n) => !(n in fixed));
    const L = splitBlock(listingBlock, isNew ? [] : noFixed(deal.listing_agents));
    const C = splitBlock(clientBlock, noFixed(deal.client_agents));
    const people = {};
    const add = (n, v) => { people[n] = (people[n] || 0) + v; };
    // 疑难单：周姐自己算好每个人拿多少（deal.manual = {amounts: {名字: 元}, note: 计算方式}），不扣 10%、不按比例分，剩下的都是店面的
    const manual = !!(deal.manual && deal.manual.amounts && !deal.parent_id);
    if (manual) Object.entries(deal.manual.amounts).forEach(([n, v]) => { const fen = toFen(v); if (fen) add(n, fen); });
    else {
      Object.entries(L.agents).forEach(([n, v]) => add(n, v));
      Object.entries(C.agents).forEach(([n, v]) => add(n, v));
    }
    Object.entries(fixed).forEach(([n, v]) => add(n, v));   // 固定拿钱的人
    // 业务员先垫付、还没还的支出：结算时加回给垫付的人
    const share = { ...people };
    const reimb = {};
    (deal.expenses || []).forEach((it) => { if (it.paid_by) reimb[it.paid_by] = (reimb[it.paid_by] || 0) + toFen(it.amount); });
    Object.entries(reimb).forEach(([n, v]) => add(n, v));
    const reimbTotal = Object.values(reimb).reduce((a, b) => a + b, 0);
    const shareSum = Object.values(share).reduce((a, b) => a + b, 0);
    const store = manual ? net - shareSum : maint + L.store + C.store;
    const warnings = [];
    if (manual) {
      if (store < 0) warnings.push('每个人加起来比总账还多，店面要倒贴，请再核对一下');
      return { income, expense, partnerCut, isCoop, net, commission, otherIncome, maintBase: 0, maint: 0, rate: 0, rest: net, profit: net, listingPct: 0, listingProfit: 0, clientProfit: 0, returns: { listing: [], client: [] }, listingReturn: 0, clientReturn: 0, listingBlock: 0, clientBlock: 0, listing: { store: 0, agents: {} }, client: { store: 0, agents: {} }, store, people, share, reimb, reimbTotal, fixed: {}, fixedTotal: 0, warnings, manual: true, manualNote: deal.manual.note || '' };
    }
    if (!isNew && listingBlock > 0 && !noFixed(deal.listing_agents).length && !(deal.listing_agents || []).length) warnings.push('没有选房源方业务员，房源方的钱暂时全算给店面');
    if (clientBlock > 0 && !(deal.client_agents || []).length) warnings.push('没有选客户方业务员，客户方的钱暂时全算给店面');
    if (net < 0) warnings.push('这一单支出大于收入');
    const inDeal = [...(isNew ? [] : deal.listing_agents || []), ...(deal.client_agents || [])];
    Object.keys(reimb).forEach((n) => { if (!inDeal.includes(n)) warnings.push(`${n}垫付了钱，但不是这一单的业务员，结算单上不会显示，请把垫付人改成这一单的业务员`); });
    return { income, expense, partnerCut, isCoop, net, commission, otherIncome, maintBase, maint, rate, rest, profit, listingPct, listingProfit, clientProfit, returns, listingReturn, clientReturn, listingBlock, clientBlock, listing: L, client: C, store, people, share, reimb, reimbTotal, fixed, fixedTotal, warnings };
  }

  // 汇总一期
  function calcPeriod(deals) {
    const totals = { income: 0, expense: 0, net: 0, maint: 0, store: 0, reimb: 0, fixed: 0, people: {} };
    const rows = deals.map((d) => {
      const r = calcDeal(d);
      totals.income += r.income; totals.expense += r.expense; totals.net += r.net;
      totals.maint += r.maint; totals.store += r.store; totals.reimb += r.reimbTotal; totals.fixed += r.fixedTotal;
      Object.entries(r.people).forEach(([n, v]) => { totals.people[n] = (totals.people[n] || 0) + v; });
      return { deal: d, r };
    });
    return { rows, totals };
  }

  // 模糊搜索：不用打全。去掉空格、横杠和“幢 栋 号 单元 室”这些字再比；
  // 汉字按顺序出现就算（“幸福3-502”能找到“幸福小区 3-502”），数字要连着（“502”不会匹配到 5、0、2 分散的号码）
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s\-—–_#/\\·.,，。、()（）:：]|号楼|单元|[幢栋号室]/g, '');
  function fuzzyOne(text, word) {
    const t = norm(text), runs = norm(word).match(/\d+|\D/g);
    if (!runs) return true;
    let pos = 0;
    for (const r of runs) { const i = t.indexOf(r, pos); if (i < 0) return false; pos = i + r.length; }
    return true;
  }
  // fields：要搜的几段文字；query：用空格隔开的几个词，每个词都要在某一段里找到
  const fuzzy = (fields, query) => String(query || '').trim().split(/\s+/).filter(Boolean).every((w) => fields.some((f) => fuzzyOne(f, w)));
  const api = { FIXED_PAY, fixedOf, fuzzy, oneSide, RETURN_SIDE, sideOf, COMMISSION_TYPES, INCOME_TYPES, INCOME_BY_TYPE, EXPENSE_TYPES, EXPENSE_BY_TYPE, MAINT_RATE, DEAL_TYPES, STORE, toFen, fmt, calcDeal, calcPeriod };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(this);
