import { resolve } from 'node:path';
import { AIError } from '../lib/ai-provider.ts';

export function deepseekAuthorizationURL(value){
  try{const url=new URL(value);if(url.protocol==='https:'&&url.hostname==='platform.deepseek.com'&&url.pathname==='/dsh/authorize'&&!url.username&&!url.password&&!url.port&&!url.hash)return url.href;}catch{}
  throw new AIError('DeepSeek вернул неподходящий адрес входа. Повтори подключение.',502,'DEEPSEEK_LOGIN_URL_INVALID');
}

export function deepseekWorkerArgs(root,operation){return [resolve(root,'local/deepseek-worker.mjs'),operation];}

export function parseDeepseekResult(result){
  let last;
  try{last=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));}catch{}
  const code=last?.error?.code;
  if(result.code!==0||code){
    if(['ACCOUNT_QUOTA','QUOTA','RATE_LIMIT'].includes(code))throw new AIError('У DeepSeek Harness закончился доступный баланс или достигнут лимит. Проверь его в аккаунте DeepSeek или выбери другой ИИ.',429,'CLIENT_RATE_LIMIT');
    if(['AUTH','CLIENT_AUTH_REQUIRED','ACCOUNT_SIGN_IN_REQUIRED','ACCOUNT_TOKEN_INVALID'].includes(code))throw new AIError('Войди в DeepSeek ещё раз.',401,'CLIENT_AUTH_REQUIRED');
    if(code==='AI_TIMEOUT')throw new AIError('DeepSeek не ответил вовремя. Повтори запрос.',504,'AI_TIMEOUT');
    if(code==='DEEPSEEK_MODEL_UNAVAILABLE')throw new AIError('Аккаунт DeepSeek не предоставил доступную модель Harness. Проверь доступ в сервисе.',503,'DEEPSEEK_MODEL_UNAVAILABLE');
    if(code==='DEEPSEEK_LOGIN_FAILED')throw new AIError('Вход DeepSeek не завершён. Повтори подключение.',401,'CLIENT_AUTH_FAILED');
    throw new AIError('DeepSeek не выполнил запрос. Проверь доступность сервиса и свой аккаунт.',502,'CLIENT_REQUEST_FAILED');
  }
  if(!last||!Object.hasOwn(last,'result'))throw new AIError('DeepSeek вернул непонятный ответ.',502,'AI_INVALID_OUTPUT');
  return last.result;
}
