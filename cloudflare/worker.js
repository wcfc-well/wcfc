// Cloudflare Worker：把国内手机的请求转发到 Supabase（国内直连 supabase.co 会被挡）
// 部署后绑定到自己的域名，例如 api.你的域名；config.js 里的 supabaseUrl 改成这个地址
// 另外：/ai/listing 用 Cloudflare 免费的 Workers AI 整理房源文字（要在 Worker 的“绑定”里加一个 Workers AI，名字填 AI）
const UPSTREAM = 'https://zfzcjpydbvvowdxhqdde.supabase.co';
const ALLOWED_PATHS = ['/rest/v1/', '/auth/v1/', '/functions/v1/'];  // functions：锁屏通知
const APP_ORIGINS = ['https://wcfc-well.github.io', 'https://wenchengfangchan.xyz', 'https://www.wenchengfangchan.xyz'];
// 依次试，前面的用不了就换下一个（都是 Cloudflare 免费额度里的模型）
const AI_MODELS = ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

const AI_PROMPT = `你是房产中介的助手。把业务员随手写的一段房源文字，整理成下面固定格式，一行一项，没有的项整行不写，不要编造，不要解释，只输出这些行：
坐落：小区名+楼栋-室号（例如 青苑新村三区26-1303）；商铺写什么路几号（例如 星华街18号门面）
价格：出售写“xx万”；出租时这一行改成“租金：xxxx元/月”
面积：数字+平
户型：类别（只能是 小户/小户带阁楼/中户/中户带阁楼/大户/大户带阁楼/特大户/特大户带阁楼/商品房/商铺 之一，看不出就不写）+ 空格 + 几室几厅（例如 中户 2室1厅）
装修：毛坯/简装/精装/豪装 之类
电梯：有（没提到就不写）
学区：原文里的学校或学区
年限：满二/满五/不满二 之类
房东：手机号+称呼，多个用“，”隔开（例如 13951118777赵总）
维护：负责的业务员称呼，空格隔开（原样写，例如 安姐 小朱）
备注：其余有用的信息（楼层、朝向、看房方式、急售等）`;

const cors = (origin) => ({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Vary': 'Origin' });

async function aiListing(request, env) {
  const origin = request.headers.get('origin') || '';
  if (!APP_ORIGINS.includes(origin)) return new Response('forbidden', { status: 403 });
  const h = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...h, 'content-type': 'application/json; charset=utf-8' } });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.AI) return json({ error: 'no_ai' }, 501);
  let text = '';
  try { text = String((await request.json()).text || '').slice(0, 1500).trim(); } catch (e) { /* 空 */ }
  if (!text) return json({ error: 'empty' }, 400);
  let last = '';
  for (const model of AI_MODELS) {
    try {
      const r = await env.AI.run(model, { messages: [{ role: 'system', content: AI_PROMPT }, { role: 'user', content: text }], max_tokens: 600, temperature: 0 });
      let out = typeof r?.response === 'string' ? r.response : r?.choices?.[0]?.message?.content || '';
      out = String(out).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```[a-z]*|```/g, '').trim();
      if (/[:：]/.test(out)) return json({ text: out });
      last = 'bad_output';
    } catch (e) { last = String(e && e.message || e).slice(0, 200); }
  }
  return json({ error: last || 'failed' }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ai/listing') return aiListing(request, env);
    if (!ALLOWED_PATHS.some((p) => url.pathname.startsWith(p))) return new Response('Not found', { status: 404 });
    const target = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const resp = await fetch(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' });
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  },
};
