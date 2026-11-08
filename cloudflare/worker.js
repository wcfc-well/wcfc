// Cloudflare Worker：把国内手机的请求转发到 Supabase（国内直连 supabase.co 会被挡）
// 部署后绑定到自己的域名，例如 api.你的域名；config.js 里的 supabaseUrl 改成这个地址
const UPSTREAM = 'https://zfzcjpydbvvowdxhqdde.supabase.co';
const ALLOWED_PATHS = ['/rest/v1/', '/auth/v1/', '/functions/v1/'];  // functions：锁屏通知

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!ALLOWED_PATHS.some((p) => url.pathname.startsWith(p))) return new Response('Not found', { status: 404 });
    const target = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const resp = await fetch(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' });
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  },
};
