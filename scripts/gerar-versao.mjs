// Roda antes do build (script "prebuild" do package.json): grava public/version.json
// com a versão deste deploy. O app guarda a versão com que abriu e compara de tempos em
// tempos (ver VersaoAppService) — mudou = subiu atualização, mostra o aviso pra
// recarregar a página. Na Vercel usa o commit do deploy; fora dela, o horário do build.
import { writeFileSync } from 'node:fs';

const versao = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;
writeFileSync(new URL('../public/version.json', import.meta.url), JSON.stringify({ versao, geradoEm: new Date().toISOString() }) + '\n');
console.log(`[gerar-versao] public/version.json → ${versao}`);
