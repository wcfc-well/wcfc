// Supabase Edge Function「push」：店面点“一起催办”时，给业务员的手机发锁屏通知
// 需要在 Supabase → Edge Functions → Secrets 里加：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // 只有登录了店面账号的人能发
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u || !u.user) return json({ error: '请先登录店面账号' }, 401);

  const { items } = await req.json().catch(() => ({ items: [] }));
  if (!Array.isArray(items) || !items.length) return json({ sent: 0, people: 0 });
  webpush.setVapidDetails('mailto:shop@wenchengfangchan.xyz', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

  const names = items.map((i: { name: string }) => String(i.name));
  const { data: subs, error } = await admin.from('push_subs').select('*').in('agent_name', names);
  if (error) return json({ error: error.message }, 500);
  const gone: string[] = [], reached = new Set<string>();
  await Promise.all((subs || []).map(async (s) => {
    const it = items.find((i: { name: string }) => i.name === s.agent_name);
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: '文城房产 · 店面提醒', body: String(it.body || '您有事情还没做完，点开看看').slice(0, 200), url: './confirm.html' }),
        { TTL: 3 * 86400, urgency: 'high' });
      reached.add(s.agent_name);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);  // 手机上关了通知或删了图标，这条作废
    }
  }));
  if (gone.length) await admin.from('push_subs').delete().in('endpoint', gone);
  return json({ sent: reached.size, people: names.length, reached: [...reached] });
});
