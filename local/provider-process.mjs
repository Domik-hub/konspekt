import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { AIError } from '../lib/ai-provider.ts';

export function stopProcess(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
    killer.on('error', () => child.kill());
  } else child.kill('SIGTERM');
}

// Never invoke a shell or put lecture text in command arguments.
export function runClient(command, args, options = {}) {
  const { input='', timeoutMs=180000, signal, onSpawn, onLine, env, cwd } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'] });
    let stdout='', stderr='', bytes=0, failure, lineBuffer='';
    const fail = error => { if (!failure) { failure=error; stopProcess(child); } };
    const timer = setTimeout(() => fail(new AIError('Нейросеть не ответила вовремя. Попробуй уменьшить число вопросов.',504,'AI_TIMEOUT')), timeoutMs);
    const abort = () => fail(new AIError('Запрос отменён.',409,'AI_CANCELLED'));
    signal?.addEventListener('abort',abort,{once:true});
    onSpawn?.(child);
    for (const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        bytes+=Buffer.byteLength(chunk);
        if (bytes>2_000_000) return fail(new AIError('Ответ нейросети слишком большой. Уменьши число вопросов.',502,'AI_OUTPUT_LIMIT'));
        if(key==='stdout'){
          stdout+=chunk;
          if(onLine){lineBuffer+=chunk;let end;while((end=lineBuffer.indexOf('\n'))!==-1){const line=lineBuffer.slice(0,end);lineBuffer=lineBuffer.slice(end+1);try{onLine(line);}catch(error){fail(error);}}}
        }else stderr+=chunk;
      });
    }
    child.on('error', () => { failure=new AIError('Не удалось запустить подключение к ИИ. Перезапусти Конспект.',503,'CLIENT_START_FAILED'); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if(failure)reject(failure);else resolve({stdout,stderr,code});
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
    if(signal?.aborted)abort();
  });
}

// ACP is the official app integration protocol. Credentials stay in the CLI.
export function acpClient(command,args,{cwd,env,signal,timeoutMs=300000,onSpawn,onUpdate}={}) {
  const child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let nextId=1;let outputBytes=0;let closed=false;
  onSpawn?.(child); child.stderr.resume(); child.stdin.on('error',()=>{});
  const lines=createInterface({input:child.stdout});
  const fail=()=>{
    if(closed)return;closed=true;
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(new AIError('Подключение прервалось. Повтори вход.',503,'CLIENT_CONNECTION_CLOSED'));}
    pending.clear();
  };
  lines.on('line',line=>{
    outputBytes+=Buffer.byteLength(line);
    if(outputBytes>1_000_000){stopProcess(child);fail();return;}
    let message;try{message=JSON.parse(line);}catch{return;}
    if(message.method==='session/update'){onUpdate?.(message.params?.update);return;}
    // This client grants no filesystem, terminal, or tool permissions.
    if(message.method && message.id!==undefined) {
      const reply=message.method==='session/request_permission'
        ? {result:{outcome:{outcome:'cancelled'}}}
        : {error:{code:-32601,message:'Client capability unavailable'}};
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:message.id,...reply})+'\n');return;
    }
    const item=pending.get(message.id);if(!item)return;
    clearTimeout(item.timer);pending.delete(message.id);
    if(message.error)item.reject(new AIError('Не удалось войти в аккаунт. Проверь, что сервис доступен твоему аккаунту, и повтори вход.',401,'CLIENT_AUTH_FAILED'));
    else item.resolve(message.result ?? {});
  });
  child.on('error',fail);child.on('close',fail);
  const abort=()=>{stopProcess(child);fail();};
  signal?.addEventListener('abort',abort,{once:true});
  return {
    request(method,params){
      if(closed)return Promise.reject(new AIError('Подключение закрыто.',503,'CLIENT_CONNECTION_CLOSED'));
      const id=nextId++;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new AIError('Вход не завершён. Нажми «Войти» ещё раз.',504,'LOGIN_TIMEOUT'));abort();},timeoutMs);
        pending.set(id,{resolve,reject,timer});
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
      });
    },
    close(){signal?.removeEventListener('abort',abort);abort();lines.close();}
  };
}

export function parseClientResult(provider,result) {
  let body;
  try { body=JSON.parse(result.stdout.trim()); } catch { body=null; }
  // Qwen's --output-format json is a transcript array. Only its terminal
  // result counts; intermediate assistant/tool messages are never a quiz.
  if(provider==='qwen'&&Array.isArray(body)){
    const terminal=body.at(-1);
    body=terminal?.type==='result'?terminal:null;
    if(body&&body.subtype!=='success'&&!body.is_error)body={is_error:true,error:{message:'Incomplete Qwen result'}};
  }
  if(result.code!==0 || body?.is_error || body?.error) {
    const diagnostic=JSON.stringify(body?.error || body?.result || '')+' '+result.stderr;
    if(/rate.?limit|quota|usage.?limit|limit.?reached|429/i.test(diagnostic))throw new AIError('У выбранного ИИ достигнут лимит. Подожди его обновления или выбери другой подключённый ИИ.',429,'CLIENT_RATE_LIMIT');
    if(/auth|login|sign.?in|credential|unauthoriz|401|403/i.test(diagnostic))throw new AIError('Войди в аккаунт выбранного ИИ. При необходимости обнови подключение.',401,'CLIENT_AUTH_REQUIRED');
    throw new AIError('Выбранный ИИ не выполнил запрос. Проверь вход и доступ аккаунта к сервису.',502,'CLIENT_REQUEST_FAILED');
  }
  if(body?.structured_output && typeof body.structured_output==='object')return body.structured_output;
  if(provider==='qwen'&&body?.structured_result&&typeof body.structured_result==='object'&&!Array.isArray(body.structured_result))return body.structured_result;
  let raw=provider==='gemini'?body?.response:body?.result;
  if(typeof raw!=='string')throw new AIError('ИИ вернул непонятный ответ. Повтори запрос.',502,'AI_INVALID_OUTPUT');
  raw=raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1');
  try {const value=JSON.parse(raw);if(value && typeof value==='object' && !Array.isArray(value))return value;}catch{}
  throw new AIError('ИИ не соблюдал формат вопросов. Попробуй ещё раз.',502,'AI_INVALID_OUTPUT');
}
