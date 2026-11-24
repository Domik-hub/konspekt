import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './provider-process.mjs';
import { AIError } from '../lib/ai-provider.ts';

async function unusedPort(){
  const listener=createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;
}

export function qwenAuthorizationURL(value){
  try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='chat.qwen.ai'&&!url.username&&!url.password&&!url.port)return url.href;}catch{}
  throw new AIError('Qwen вернул неподходящий адрес входа. Повтори подключение.',502,'QWEN_LOGIN_URL_INVALID');
}

// The official Qwen daemon owns its OAuth flow and token store. Only its public
// account state and one-time browser authorization link cross this boundary.
export async function qwenAccountServer(options,signal){
  const port=await unusedPort();const origin=`http://127.0.0.1:${port}`;const token=randomBytes(32).toString('base64url');
  const child=spawn(options.command,[...options.prefix,'--safe-mode','serve','--hostname','127.0.0.1','--port',String(port),'--require-auth','--workspace',options.cwd,'--max-total-sessions','1'],{
    cwd:options.cwd,env:{...options.env,QWEN_SERVER_TOKEN:token},windowsHide:true,shell:false,stdio:['ignore','ignore','ignore'],
  });
  let failed=false;child.on('error',()=>{failed=true;});child.on('exit',()=>{failed=true;});
  const stop=()=>stopProcess(child);signal?.addEventListener('abort',stop,{once:true});
  const call=async(path,method='GET',body)=>{
    const response=await fetch(origin+path,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([AbortSignal.timeout(35000),...(signal?[signal]:[])])});
    if(response.status===204)return null;
    const data=await response.json();
    if(!response.ok){
      if(data.code==='subscription_required')throw new AIError('Для этого подключения нужна подписка Qwen Plus или Pro.',403,'QWEN_SUBSCRIPTION_REQUIRED');
      throw new AIError('Qwen не смог завершить подключение. Проверь вход и доступность сервиса.',502,'QWEN_ACCOUNT_FAILED');
    }
    return data;
  };
  try{
    const until=Date.now()+30000;
    while(Date.now()<until){
      signal?.throwIfAborted();if(failed)break;
      try{await call('/auth/subscription?paywallScene=cli');return {call,close:()=>{signal?.removeEventListener('abort',stop);stop();}};}catch(error){if(signal?.aborted)throw error;}
      await delay(250,undefined,{signal});
    }
    throw new AIError('Не удалось запустить вход Qwen. Перезапусти сайт и повтори.',503,'QWEN_START_FAILED');
  }catch(error){signal?.removeEventListener('abort',stop);stop();throw error;}
}

export async function connectQwen(options,{signal,onURL}){
  const daemon=await qwenAccountServer(options,signal);let flowId;
  try{
    const flow=await daemon.call('/auth/subscription/flows?paywallScene=cli','POST',{});flowId=flow.id;
    if(typeof flowId!=='string')throw new AIError('Не удалось начать вход Qwen.',502,'QWEN_ACCOUNT_FAILED');
    const until=Date.now()+300000;
    while(Date.now()<until){
      signal.throwIfAborted();
      const state=await daemon.call(`/auth/subscription/flows/${encodeURIComponent(flowId)}`);
      if(state.authorizationUrl)onURL(qwenAuthorizationURL(state.authorizationUrl));
      if(state.status==='ready'){
        const activation=await daemon.call('/auth/subscription/model','POST',{});
        if(typeof activation?.modelId!=='string'||activation.modelId.length>180)throw new AIError('Qwen не предоставил доступную модель.',503,'QWEN_MODEL_UNAVAILABLE');
        return {model:activation.modelId};
      }
      if(state.status==='error')throw new AIError('Вход Qwen не завершён. Повтори вход на странице сервиса.',401,'QWEN_AUTH_FAILED');
      await delay(1500,undefined,{signal});
    }
    throw new AIError('Время входа Qwen истекло. Нажми «Войти» ещё раз.',504,'LOGIN_TIMEOUT');
  }finally{
    if(flowId&&!signal.aborted)await daemon.call(`/auth/subscription/flows/${encodeURIComponent(flowId)}`,'DELETE').catch(()=>{});
    daemon.close();
  }
}
