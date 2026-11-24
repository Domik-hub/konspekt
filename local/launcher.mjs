import { spawn } from 'node:child_process';
import { open, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4317';
const args = new Set(process.argv.slice(2));
async function running() {
  let response;
  try { response = await fetch(`${origin}/api/local/ping`, { signal: AbortSignal.timeout(1500) }); }
  catch { return false; }
  let data; try { data = await response.json(); } catch { throw new Error('Порт 4317 занят другим приложением.'); }
  if (!response.ok && data.code === 'STARTING') return false;
  if (data.app !== 'konspekt-local' || data.version !== 1) throw new Error('Порт 4317 занят другим приложением.');
  return true;
}

try {
  if (args.has('--stop')) {
    if (!await running()) { console.log('Конспект уже остановлен.'); process.exit(0); }
    const status = await fetch(`${origin}/api/ai/status`, { signal:AbortSignal.timeout(65000) });
    const data = await status.json(); const cookie = status.headers.get('set-cookie')?.split(';')[0];
    if (!status.ok || !data.csrfToken || !cookie) throw new Error('Не удалось подтвердить локальную сессию.');
    const response = await fetch(`${origin}/api/local/stop`, { method:'POST',headers:{'content-type':'application/json',Origin:origin,Cookie:cookie,'X-Konspekt-CSRF':data.csrfToken},body:'{}' });
    if (!response.ok) throw new Error((await response.json()).error || 'Не удалось остановить приложение.');
    console.log('Конспект остановлен. Аккаунт сохранён для следующего запуска.');
  } else {
    if (!await running()) {
      await mkdir(resolve(root,'.local-data'),{recursive:true});
      const log = await open(resolve(root,'.local-data/server.log'),'a',0o600);
      const child = spawn(process.execPath,[resolve(root,'local/server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      let failed = false;child.on('error',()=>{failed=true;});child.unref();await log.close();
      let ready = false;
      for (let attempt=0;attempt<40;attempt++) { if(failed)break;await new Promise(resolveWait=>setTimeout(resolveWait,250));if(await running()){ready=true;break;} }
      if (!ready) throw new Error('Не удалось запустить Конспект. Проверь, что папка проекта сохранена целиком и порт 4317 свободен.');
    }
    if (!args.has('--no-open')) {
      const browser = spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{detached:true,windowsHide:true,stdio:'ignore'});
      browser.on('error',()=>{console.log(`Открой в браузере ${origin}`);});browser.unref();
    }
    console.log(`Конспект готов: ${origin}`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Не удалось запустить Конспект.');process.exitCode=1; }
