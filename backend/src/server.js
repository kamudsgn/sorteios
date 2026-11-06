import { loadConfig } from './config.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const app = createApp(cfg);

app.listen(cfg.port, cfg.host, () => {
  const ig = cfg.instagram;
  console.log(`\n  Sorteador — API em http://${cfg.host}:${cfg.port}`);
  console.log(`  Instagram: ${ig.envToken ? 'token do .env encontrado' : 'sem token no .env'} · OAuth ${ig.appId && ig.appSecret && ig.redirectUri ? 'configurado' : 'não configurado'}\n`);
});
