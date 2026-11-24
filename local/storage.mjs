import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function protect(value, mode) {
  if (process.platform !== 'win32') return value;
  // Run the fixed helper as a command without changing Windows execution policy.
  // Credentials travel only through stdin/stdout, never command-line arguments.
  const helper = await readFile(fileURLToPath(new URL('./protect-store.ps1', import.meta.url)), 'utf8');
  return new Promise((resolveResult, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& {${helper}} -Mode ${mode}`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let length = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Не удалось открыть защищённое хранилище аккаунтов.')); }, 15000);
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 2000000) child.kill(); else chunks.push(chunk); });
    child.stderr.resume(); // Never forward credential-helper diagnostics to logs.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Не удалось запустить защищённое хранилище аккаунтов.')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolveResult(Buffer.concat(chunks).toString('utf8')); else reject(new Error('Не удалось прочитать аккаунты под текущим пользователем Windows.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(value);
  });
}

export async function createLocalStore(directory) {
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink() || (await realpath(dir)).toLowerCase() !== dir.toLowerCase()) throw new Error('Папка аккаунтов не должна быть ссылкой.');
  const target = join(dir, process.platform === 'win32' ? 'accounts.dpapi' : 'accounts.json');
  const hostPath = join(dir, 'host.json');
  async function regular(path) { try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Недопустимый файл аккаунта.'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  await regular(target); await regular(hostPath);
  let host;
  try { host = JSON.parse(await readFile(hostPath, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Не удалось прочитать идентификатор приложения.');
    host = { hostId: `urn:uuid:${randomUUID()}` };
    try { await writeFile(hostPath, JSON.stringify(host), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; host = JSON.parse(await readFile(hostPath, 'utf8')); }
  }
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(host.hostId)) throw new Error('Неверный идентификатор приложения.');
  let queue = Promise.resolve();
  return {
    hostId: host.hostId,
    async load() {
      try {
        const state = JSON.parse(await protect(await readFile(target, 'utf8'), 'unprotect'));
        if (state.version !== 1 || !Array.isArray(state.accounts)) throw new Error();
        return state;
      } catch (e) { if (e.code === 'ENOENT') return { version: 1, activeId: null, accounts: [] }; throw new Error('Не удалось открыть сохранённые аккаунты. Запусти приложение под тем же пользователем Windows.'); }
    },
    save(state) {
      const snapshot = JSON.stringify(state);
      queue = queue.catch(() => {}).then(async () => {
        await regular(target);
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, await protect(snapshot, 'protect'), { flag: 'wx', mode: 0o600 });
        await rename(temporary, target);
      });
      return queue;
    },
  };
}
