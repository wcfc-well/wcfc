// 云数据库设置。两项都留空 = 演示模式（数据只存在这台设备上）。
// 这两项本来就是公开放在网页里的，不是密码。
window.APP_CONFIG = {
  supabaseUrl: 'https://api.wenchengfangchan.xyz',
  supabaseAnonKey: 'sb_publishable_jfoRTlYSrPY06vGPmtmH9g_r9fkP5aI',
  // 锁屏通知（只有 iPhone 能收到，店里基本是安卓，先不用）：要用的话把公钥填回这里，见 supabase/functions/push
  pushPublicKey: '',
};
