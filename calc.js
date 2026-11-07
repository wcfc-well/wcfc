// 分账算法（所有金额用“分”为单位的整数计算，避免小数误差）
// 规则：
//   每一单：净额 = 收入合计 − 支出合计
//   店面维护成本 = （佣金 − 支出）× 10%，银行返点等其他收入不扣（新房没有这一项）
//   剩余 = 净额 − 店面维护成本
//   二手/租房：房源方 20%，客户方 80%；新房：没有房源方，100% 客户方
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
  };
  const MAINT_RATE = { '二手买卖': 10, '租房': 10, '新房': 0 };
  // 只有佣金扣店面维护成本；银行返点、装修返点、垫资返点、其他收入都不扣
  const COMMISSION_TYPES = ['卖房房东佣金', '卖房客户佣金', '租房佣金', '开发商佣金'];
  const DEAL_TYPES = ['二手买卖', '租房', '新房'];
  // 每种房屋类型对应的佣金；返点和其他收入所有类型都可能有
  const COMMON_INCOME = ['银行返点', '装修返点', '垫资返点', '其他收入'];
  const INCOME_BY_TYPE = {
    '二手买卖': ['卖房房东佣金', '卖房客户佣金', ...COMMON_INCOME],
    '租房': ['租房佣金', ...COMMON_INCOME],
    '新房': ['开发商佣金', ...COMMON_INCOME],
  };
  const STORE = '店面';

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

  // 计算一单
  function calcDeal(deal) {
    const income = sum(deal.incomes);
    const expense = sum(deal.expenses);
    const net = income - expense;
    const rate = MAINT_RATE[deal.type] == null ? 10 : MAINT_RATE[deal.type];
    const commission = sum((deal.incomes || []).filter((i) => COMMISSION_TYPES.includes(i.type)));
    const otherIncome = income - commission;
    const maintBase = Math.max(0, commission - expense);     // 佣金减去支出后的部分才扣 10%
    const maint = Math.floor(maintBase * rate / 100);
    const rest = net - maint;
    const isNew = deal.type === '新房';
    const listingBlock = isNew ? 0 : Math.floor(rest * 20 / 100);
    const clientBlock = rest - listingBlock;
    const L = splitBlock(listingBlock, isNew ? [] : deal.listing_agents);
    const C = splitBlock(clientBlock, deal.client_agents);
    const people = {};
    const add = (n, v) => { people[n] = (people[n] || 0) + v; };
    Object.entries(L.agents).forEach(([n, v]) => add(n, v));
    Object.entries(C.agents).forEach(([n, v]) => add(n, v));
    // 业务员先垫付、还没还的支出：结算时加回给垫付的人
    const share = { ...people };
    const reimb = {};
    (deal.expenses || []).forEach((it) => { if (it.paid_by) reimb[it.paid_by] = (reimb[it.paid_by] || 0) + toFen(it.amount); });
    Object.entries(reimb).forEach(([n, v]) => add(n, v));
    const reimbTotal = Object.values(reimb).reduce((a, b) => a + b, 0);
    const store = maint + L.store + C.store;
    const warnings = [];
    if (!isNew && listingBlock > 0 && (!deal.listing_agents || !deal.listing_agents.length)) warnings.push('没有选房源方业务员，房源方的钱暂时全算给店面');
    if (clientBlock > 0 && (!deal.client_agents || !deal.client_agents.length)) warnings.push('没有选客户方业务员，客户方的钱暂时全算给店面');
    if (net < 0) warnings.push('这一单支出大于收入');
    const inDeal = [...(isNew ? [] : deal.listing_agents || []), ...(deal.client_agents || [])];
    Object.keys(reimb).forEach((n) => { if (!inDeal.includes(n)) warnings.push(`${n}垫付了钱，但不是这一单的业务员，结算单上不会显示，请把垫付人改成这一单的业务员`); });
    return { income, expense, net, commission, otherIncome, maintBase, maint, rate, rest, listingBlock, clientBlock, listing: L, client: C, store, people, share, reimb, reimbTotal, warnings };
  }

  // 汇总一期
  function calcPeriod(deals) {
    const totals = { income: 0, expense: 0, net: 0, maint: 0, store: 0, reimb: 0, people: {} };
    const rows = deals.map((d) => {
      const r = calcDeal(d);
      totals.income += r.income; totals.expense += r.expense; totals.net += r.net;
      totals.maint += r.maint; totals.store += r.store; totals.reimb += r.reimbTotal;
      Object.entries(r.people).forEach(([n, v]) => { totals.people[n] = (totals.people[n] || 0) + v; });
      return { deal: d, r };
    });
    return { rows, totals };
  }

  const api = { COMMISSION_TYPES, INCOME_TYPES, INCOME_BY_TYPE, EXPENSE_TYPES, EXPENSE_BY_TYPE, MAINT_RATE, DEAL_TYPES, STORE, toFen, fmt, calcDeal, calcPeriod };
  if (typeof module !== 'undefined') module.exports = api; else root.Calc = api;
})(this);
