import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ChatGPTConnection, ConnectionError, sameSecret } from './chatgpt-auth.mjs';
import { createLocalStore } from './storage.mjs';
import { AIError, createSemanticQuestions, gradeSemanticAnswer } from '../lib/ai-provider.ts';
import { AIConnections } from './ai-connections.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mjs': 'text/javascript; charset=utf-8' };
const random = () => randomBytes(32).toString('base64url');

export async function startLocalServer({ port = 4317, dataDirectory = resolve(root, '.local-data'), staticDirectory = resolve(root, 'dist-local/client'), connection: suppliedConnection, connections: suppliedConnections, generate = createSemanticQuestions, grade = gradeSemanticAnswer } = {}) {
  const sessions = new Map(); const rates = new Map(); let connection; let origin; let accountMutation = false; let inferenceBusy = false;
  const connections = suppliedConnections || new AIConnections({root,dataDirectory});
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function session(req, res, create = false) {
    const id = /(?:^|;\s*)konspekt_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    let value = sessions.get(id);
    if (value && value.expiresAt < Date.now()) { sessions.delete(id); value = null; }
    if (!value && create) {
      for (const [key, item] of sessions) if (item.expiresAt < Date.now()) sessions.delete(key);
      if (sessions.size >= 100) throw new ConnectionError('Слишком много открытых сессий. Перезапусти приложение.', 'SESSION_LIMIT', 429);
      value = { id: random(), csrf: random(), expiresAt: Date.now() + 86400000 };
      sessions.set(value.id, value);
      res.setHeader('Set-Cookie', `konspekt_session=${value.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    }
    return value;
  }
  async function body(req, browser) {
    if (!browser || req.headers.origin !== origin || !sameSecret(req.headers['x-konspekt-csrf'], browser.csrf)) throw new ConnectionError('Обнови страницу приложения и повтори действие.', 'INVALID_ORIGIN_OR_CSRF', 403);
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new ConnectionError('Ожидался JSON.', 'INVALID_CONTENT_TYPE', 415);
    if (Number(req.headers['content-length']) > 650000) throw new ConnectionError('Слишком большой материал.', 'BODY_TOO_LARGE', 413);
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 650000) throw new ConnectionError('Слишком большой материал.', 'BODY_TOO_LARGE', 413); chunks.push(chunk); }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; }
    catch { throw new ConnectionError('Не удалось прочитать запрос.', 'INVALID_JSON', 400); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!origin || req.headers.host !== new URL(origin).host || req.socket.remoteAddress !== '127.0.0.1') return json(res, 403, { error: 'Открой приложение по адресу 127.0.0.1.', code: 'INVALID_HOST' });
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return json(res, 403, { error: 'Недопустимый адрес.', code: 'INVALID_HOST' });
      if (!connection) return json(res, 503, { error: 'Приложение запускается.', code: 'STARTING' });
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const browser = session(req, res);
        try {
          if (!browser) throw new ConnectionError('Сессия входа не найдена. Начни вход ещё раз.', 'INVALID_STATE', 400);
          if (accountMutation) throw new ConnectionError('Другое подключение ещё выполняется. Попробуй снова.', 'ACCOUNT_BUSY', 409);
          accountMutation = true;
          try { const result = await connection.callback(browser.id, url); browser.notice = result.planEnabled ? 'Вход выполнен. Проверяем доступ к моделям.' : 'Вход выполнен. Разреши приложению использовать подписку ChatGPT.'; }
          finally { accountMutation = false; }
        } catch (error) { if (browser) browser.notice = error instanceof ConnectionError ? error.message : 'Вход не завершён. Попробуй снова.'; }
        res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); return res.end();
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Запрос разрешён только из приложения.', code: 'INVALID_ORIGIN' });
        if (req.method === 'GET' && url.pathname === '/api/local/ping') return json(res, 200, { app: 'konspekt-local', version: 1 });
        if (req.method === 'GET' && url.pathname === '/api/ai/status') {
          const browser = session(req, res, true);
          const provider = connections.state.active;
          const status = provider === 'chatgpt' ? await connection.status() : {configured:false,account:null,accounts:[],models:[],connectionError:''};
          const providers = await connections.status();
          const selected = providers.find(item=>item.id===provider);
          const notice = browser.notice || ''; browser.notice = '';
          return json(res, 200, { ...status, chatgpt:provider==='chatgpt'?status:null, provider, providers, configured:provider==='chatgpt'?status.configured:Boolean(selected?.installed && selected?.connected), connectionError:provider==='chatgpt'?status.connectionError:selected?.error||'', csrfToken: browser.csrf, notice });
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'Метод не поддерживается.', code: 'METHOD_NOT_ALLOWED' });
        const browser = session(req, res); const input = await body(req, browser);
        if (url.pathname === '/api/local/stop') {
          if (accountMutation || inferenceBusy || connections.logins.size) throw new ConnectionError('Дождись завершения текущего действия и повтори остановку.', 'REQUEST_BUSY', 409);
          connection.stopActive(); connections.stopActive();
          res.once('finish', () => { server.close(); server.closeIdleConnections(); });
          return json(res, 200, { ok: true });
        }
        if (url.pathname.startsWith('/api/providers/')) {
          if(accountMutation || inferenceBusy)throw new ConnectionError('Дождись завершения текущего запроса.', 'REQUEST_BUSY',409);
          accountMutation=true;
          try {
            switch(url.pathname){
              case '/api/providers/select': await connections.select(input.id); break;
              case '/api/providers/connect': return json(res,200,await connections.connect(input.id));
              case '/api/providers/cancel': await connections.cancel(input.id); break;
              case '/api/providers/disconnect': return json(res,200,await connections.disconnect(input.id));
              default: return json(res,404,{error:'Действие не найдено.',code:'NOT_FOUND'});
            }
            return json(res,200,{ok:true});
          }finally{accountMutation=false;}
        }
        if (url.pathname.startsWith('/api/account/')) {
          if (accountMutation) throw new ConnectionError('Дождись завершения предыдущего действия с аккаунтом.', 'ACCOUNT_BUSY', 409);
          accountMutation = true;
          try {
            switch (url.pathname) {
              case '/api/account/sign-in': return json(res, 200, { redirectURL: await connection.start(browser.id, origin, { accountId: typeof input.accountId === 'string' ? input.accountId : undefined, enablePlan: input.enablePlan === true }) });
              case '/api/account/select': await connection.activate(input.id); break;
              case '/api/account/model': await connection.selectModel(input.model); break;
              case '/api/account/welcome': await connection.welcomeSeen(); break;
              case '/api/account/sign-out': return json(res, 200, await connection.disconnect());
              default: return json(res, 404, { error: 'Действие не найдено.', code: 'NOT_FOUND' });
            }
            return json(res, 200, { ok: true });
          } finally { accountMutation = false; }
        }
        if (url.pathname === '/api/questions' || url.pathname === '/api/grade') {
          if (accountMutation || inferenceBusy) throw new ConnectionError('Дождись завершения текущего запроса.', 'REQUEST_BUSY', 409);
          const key = `${connections.state.active}:${connection.state.activeId}:${url.pathname}`; const now = Date.now();
          const history = (rates.get(key) || []).filter(time => time > now - 60000);
          if (history.length >= (url.pathname === '/api/questions' ? 6 : 45)) throw new ConnectionError('Слишком много запросов. Подожди минуту.', 'RATE_LIMIT', 429);
          rates.set(key, [...history, now]); inferenceBusy = true;
          try { const config = connections.state.active==='chatgpt' ? await connection.inferenceConfig() : connections.inferenceConfig(); const output = await (url.pathname === '/api/questions' ? generate : grade)(input, config); return json(res, 200, output); }
          finally { inferenceBusy = false; }
        }
        return json(res, 404, { error: 'Действие не найдено.', code: 'NOT_FOUND' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Метод не поддерживается.' });
      let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Неверный адрес.' }); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) return json(res, 404, { error: 'Страница не найдена.' });
      let file = resolve(staticDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(resolve(staticDirectory) + sep)) return json(res, 404, { error: 'Страница не найдена.' });
      try { if (!(await stat(file)).isFile()) throw new Error(); } catch { if (extname(pathname)) return json(res, 404, { error: 'Файл не найден.' }); file = resolve(staticDirectory, 'index.html'); }
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const known = error instanceof ConnectionError || error instanceof AIError;
      json(res, known ? error.status : 500, { error: known ? error.message : 'Не удалось выполнить действие. Перезапусти приложение и попробуй снова.', code: known ? error.code : 'LOCAL_ERROR' });
    }
  });
  server.requestTimeout = 210000; server.headersTimeout = 15000;
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveReady(); }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  try { await connections.init(); const readyConnection = suppliedConnection || new ChatGPTConnection({ store: await createLocalStore(dataDirectory) }); await readyConnection.init(); connection = readyConnection; }
  catch (error) { server.close(); throw error; }
  return { server, origin, connection, connections, close: () => new Promise(resolveClosed => { connection.stopActive(); connections.stopActive(); server.close(resolveClosed); server.closeIdleConnections(); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const app = await startLocalServer();
    console.log(`Конспект запущен: ${app.origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit(0)));
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? 'Порт 4317 занят. Если Конспект уже запущен, открой http://127.0.0.1:4317.' : 'Не удалось запустить Конспект. Проверь сборку и доступ к локальному хранилищу.');
    process.exitCode = 1;
  }
}
