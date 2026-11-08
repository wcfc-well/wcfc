// 云数据库设置。两项都留空 = 演示模式（数据只存在这台设备上）。
// 这两项本来就是公开放在网页里的，不是密码。
window.APP_CONFIG = {
  supabaseUrl: 'https://api.wenchengfangchan.xyz',
  supabaseAnonKey: 'sb_publishable_jfoRTlYSrPY06vGPmtmH9g_r9fkP5aI',
  // 锁屏通知用的公钥（公开的，不是密码；配对的私钥只放在 Supabase 的 Secrets 里）
  pushPublicKey: 'BCZ0sOC-MuAmUXNbZFUXOi1K0rOlnHlbPTFUUHlaJLHJjsgarBddGfTG72ucVjtRnb9GGPnzurdnbpEXh13NWIc',
};
