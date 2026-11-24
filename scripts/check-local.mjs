import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { ChatGPTConnection, ISSUER, RESOURCE, PLAN_SCOPE, sameSecret, validateIdentity } from '../local/chatgpt-auth.mjs';
import { createLocalStore } from '../local/storage.mjs';
import { startLocalServer } from '../local/server.mjs';
import { requestStructured, readCompletedResponse } from '../lib/ai-provider.ts';

// These tests use fake credentials and local fixtures only. No real model calls.
const metadata = { issuer:ISSUER, authorization_endpoint:`${ISSUER}/api/accounts/authorize`, token_endpoint:`${ISSUER}/api/accounts/oauth/token`, jwks_uri:`${ISSUER}/.well-known/jwks.json`, revocation_endpoint:`${ISSUER}/api/accounts/oauth/revoke` };
const tokenSet = (scope=PLAN_SCOPE) => ({access_token:'fixture-access-token-not-real-0001',refresh_token:'fixture-refresh-not-real-0001',id_token:'fixture-id-token',token_type:'Bearer',expires_in:3600,scope});
const reply = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function fixture() {
  let saved = {version:1,activeId:null,accounts:[]};
  const calls = []; const state = {tokens:tokenSet(),subject:'subject-one',now:Date.now(),tokenError:null,revocationStatus:200};
  const store = {hostId:'urn:uuid:03f9a981-c176-434f-83c8-58f050b3b900',load:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);}};
  const fetcher = async (url,options={}) => {
    calls.push({url:String(url),options});
    if (url === `${ISSUER}/.well-known/openid-configuration`) return reply(metadata);
    if (url === metadata.token_endpoint) { await new Promise(resolve=>setTimeout(resolve,5)); return state.tokenError ? reply({error:state.tokenError},400) : reply(state.tokens); }
    if (url === metadata.revocation_endpoint) return new Response(null,{status:state.revocationStatus});
    if (url === `${RESOURCE}/models`) return reply({models:[{slug:'hidden',display_name:'Hidden',visibility:'hide'},{slug:'model-b',display_name:'Model B',visibility:'list'},{slug:'model-a',display_name:'Model A',visibility:'list'}]});
    throw new Error('Unexpected network request in fixture');
  };
  const manager = new ChatGPTConnection({store,fetcher,now:()=>state.now,verifyIdentity:async(_token,_key,expected)=>{if(expected.subject && expected.subject!==state.subject)throw new Error('wrong subject');return {sub:state.subject,email:'fixture@example.test',name:'Fixture'};}});
  await manager.init();
  async function begin(options) { const url = new URL(await manager.start('browser-one','http://127.0.0.1:4317',options)); return {url,attempt:manager.attempts.get(url.searchParams.get('state'))}; }
  async function login(clientId='registered-client-one',options) { const {attempt}=await begin(options);return manager.callback('browser-one',new URL(`http://127.0.0.1:4317/auth/callback?state=${attempt.state}&client_id=${clientId}&code=fixture-code`)); }
  return {manager,calls,state,store,begin,login};
}
const tokenCalls = f => f.calls.filter(call=>call.url===metadata.token_endpoint);

test('registration uses stable host, exact loopback URI, S256, direct grant and fresh state',async()=>{
  const f=await fixture(); const first=await f.begin(); const params=first.url.searchParams;
  assert.equal(params.get('client_id'),'dynamic_agent_client');assert.equal(params.get('agent_name_hint'),'Конспект');assert.equal(params.get('resource'),RESOURCE);assert.equal(params.get('ext_agent_host_id'),f.store.hostId);
  assert.equal(params.get('redirect_uri'),'http://127.0.0.1:4317/auth/callback');assert.ok(params.get('scope').includes(PLAN_SCOPE));assert.equal(params.get('code_challenge'),createHash('sha256').update(first.attempt.verifier).digest('base64url'));
  const second=await f.begin();assert.notEqual(second.attempt.state,first.attempt.state);assert.notEqual(second.attempt.nonce,first.attempt.nonce);assert.equal(params.get('client_secret'),null);
});
test('wrong, expired, replayed or other-browser state never exchanges a code',async()=>{
  for(const mode of ['wrong','expired','replay','browser']){
    const f=await fixture();const {attempt}=await f.begin();
    if(mode==='expired')f.state.now+=600001;
    const url=new URL(`http://127.0.0.1:4317/auth/callback?state=${mode==='wrong'?'wrong':attempt.state}&client_id=registered-client-one&code=fixture`);
    if(mode==='replay')await f.manager.callback('browser-one',url);
    const before=tokenCalls(f).length;
    await assert.rejects(f.manager.callback(mode==='browser'?'other-browser':'browser-one',url),e=>e.code==='INVALID_STATE');assert.equal(tokenCalls(f).length,before);
  }
  assert.equal(sameSecret('a','é'),false);
});
test('declined consent and changed returning client ID cannot replace a working session',async()=>{
  const f=await fixture();await f.login();const id=f.manager.account().id;const oldToken=f.manager.account().accessToken;
  const {attempt,url}=await f.begin({accountId:id});assert.equal(url.searchParams.get('client_id'),'registered-client-one');assert.equal(url.searchParams.get('agent_name_hint'),null);
  await assert.rejects(f.manager.callback('browser-one',new URL(`http://127.0.0.1:4317/auth/callback?state=${attempt.state}&client_id=other-client&code=bad`)),e=>e.code==='INVALID_CALLBACK');
  const next=await f.begin({accountId:id});const before=tokenCalls(f).length;
  await assert.rejects(f.manager.callback('browser-one',new URL(`http://127.0.0.1:4317/auth/callback?state=${next.attempt.state}&error=access_denied`)),e=>e.code==='CONSENT_DECLINED');
  assert.equal(tokenCalls(f).length,before);assert.equal(f.manager.account().accessToken,oldToken);
});
test('JWT signature, issuer, audience, expiry, nonce and subject are verified',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('ES256');const other=await generateKeyPair('ES256');
  const make=(values={})=>new SignJWT({sub:values.sub||'student',nonce:values.nonce||'nonce-one'}).setProtectedHeader({alg:'ES256'}).setIssuer(values.issuer||ISSUER).setAudience(values.aud||'issued-client').setIssuedAt().setExpirationTime(values.exp||'1h').sign(values.key||privateKey);
  const expected={clientId:'issued-client',nonce:'nonce-one',subject:'student'};
  assert.equal((await validateIdentity(await make(),publicKey,expected)).sub,'student');
  for(const change of [{nonce:'wrong'},{sub:'other'},{issuer:'https://example.test'},{aud:'other-client'},{exp:1},{key:other.privateKey}])await assert.rejects(validateIdentity(await make(change),publicKey,expected));
});
test('accounts with the same email remain separate and catalog preserves display order',async()=>{
  const f=await fixture();await f.login();const first=f.manager.account();f.state.subject='subject-two';await f.login('registered-client-two');const second=f.manager.account();assert.notEqual(first.id,second.id);
  assert.equal(f.manager.state.accounts.length,2);const status=await f.manager.status();assert.deepEqual(status.models.map(item=>item.slug),['model-b','model-a']);assert.equal(status.account.model,'model-b');
  assert.ok(!JSON.stringify(status).includes('fixture-access'));assert.ok(!JSON.stringify(status).includes('fixture-refresh'));assert.ok(!JSON.stringify(status).includes('id_token'));
  await f.manager.activate(first.id);assert.equal(f.manager.account().clientId,'registered-client-one');
  f.state.subject='subject-two';await assert.rejects(f.login('registered-client-one',{accountId:first.id}),e=>e.code==='INVALID_IDENTITY');assert.equal(f.manager.account().id,first.id);
});
test('identity without a fresh direct scope cannot use plan inference',async()=>{
  const f=await fixture();await f.login();const account=f.manager.account();f.state.tokens=tokenSet('openid profile');await f.login(account.clientId,{accountId:account.id});
  assert.equal((await f.manager.status()).configured,false);await assert.rejects(f.manager.inferenceConfig(),e=>e.code==='CHATGPT_PLAN_PERMISSION_REQUIRED');
  const {url}=await f.begin({accountId:account.id,enablePlan:true});assert.equal(url.searchParams.get('prompt'),'consent');assert.equal(f.calls.some(call=>call.url===`${RESOURCE}/models`),false);
});
test('refreshes are serialized, rotate atomically and omit scope',async()=>{
  const f=await fixture();await f.login();const account=f.manager.account();account.expiresAt=0;f.state.tokens={...tokenSet(),access_token:'fixture-access-token-rotated-0002',refresh_token:'fixture-refresh-rotated-0002'};
  const before=tokenCalls(f).length;const values=await Promise.all([f.manager.access(account),f.manager.access(account),f.manager.access(account)]);
  assert.equal(tokenCalls(f).length,before+1);assert.equal(new Set(values).size,1);assert.equal(account.refreshToken,f.state.tokens.refresh_token);
  const form=tokenCalls(f).at(-1).options.body;assert.equal(form.get('scope'),null);assert.equal(form.get('client_id'),account.clientId);assert.equal(form.get('resource'),RESOURCE);
  assert.equal((await f.store.load()).accounts[0].refreshToken,f.state.tokens.refresh_token);
});
test('terminal refresh clears tokens but retains registration; transient errors retain tokens',async()=>{
  for(const error of ['invalid_grant','server_error']){const f=await fixture();await f.login();const account=f.manager.account();account.expiresAt=0;f.state.tokenError=error;await assert.rejects(f.manager.access(account));assert.equal(Boolean(account.accessToken),error==='server_error');assert.equal(account.clientId,'registered-client-one');}
});
test('sign-out aborts requests, revokes latest token and preserves registration',async()=>{
  const f=await fixture();await f.login();const account=f.manager.account();await f.manager.inferenceConfig();const signal=f.manager.controllers.get(account.id).signal;
  account.expiresAt=0;f.state.tokens={...tokenSet(),refresh_token:'fixture-refresh-rotated-for-revocation'};const refreshing=f.manager.access(account);const result=await f.manager.disconnect();await refreshing;
  assert.equal(result.revoked,true);assert.equal(signal.aborted,true);assert.equal(f.calls.find(call=>call.url===metadata.revocation_endpoint).options.body.get('token'),f.state.tokens.refresh_token);assert.equal(account.accessToken,undefined);assert.equal(account.clientId,'registered-client-one');
});
test('unconfirmed remote revocation still clears local tokens and is reported',async()=>{
  const f=await fixture();await f.login();f.state.revocationStatus=503;assert.equal((await f.manager.disconnect()).revoked,false);assert.equal(f.manager.account().accessToken,undefined);assert.equal(f.calls.filter(call=>call.url===metadata.revocation_endpoint).length,2);
});

const stream=(events)=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join(''),{headers:{'content-type':'text/event-stream'}});
const complete={type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'{"answer":"complete"}'}]}]}};
test('plan request uses selected model, array input, streaming, store false and no API key fallback',async()=>{
  let calls=0;
  const result=await requestStructured({authMode:'chatgpt',accessToken:'fixture-oauth',apiKey:'must-not-use-api-key',model:'account-model',fetcher:async(_url,options)=>{calls++;const data=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer fixture-oauth');assert.equal(data.model,'account-model');assert.equal(data.stream,true);assert.equal(data.store,false);assert.ok(Array.isArray(data.input));for(const field of ['max_output_tokens','temperature','top_p','reasoning','user'])assert.equal(field in data,false);return stream([complete]);}},'instructions',{lecture:'text'},{type:'object'},'fixture',1000);
  assert.deepEqual(result,{answer:'complete'});assert.equal(calls,1);
  await assert.rejects(requestStructured({authMode:'chatgpt',apiKey:'must-not-fallback',model:'account-model',fetcher:async()=>{throw new Error('must not call');}},'test',{},{} ,'fixture',1000),e=>e.code==='AI_NOT_CONFIGURED');
});
test('question generation uses low reasoning; plan grading preserves its default effort',async()=>{
  for(const name of ['lecture_questions','lecture_answer_grade']){
    await requestStructured({authMode:'chatgpt',accessToken:'fixture-oauth',model:'account-model',fetcher:async(_url,options)=>{
      const data=JSON.parse(options.body);
      assert.deepEqual(data.reasoning,name==='lecture_questions'?{effort:'low'}:undefined);
      assert.equal(data.stream,true);assert.equal(data.store,false);assert.equal('max_output_tokens' in data,false);
      return stream([complete]);
    }},'instructions',{}, {type:'object'},name,1000);
  }
});
test('stream failures after deltas, incomplete streams and quota errors cannot be treated as success',async()=>{
  const delta={type:'response.output_text.delta',delta:'{"answer":"partial"}'};
  await assert.rejects(readCompletedResponse(stream([delta])),e=>e.code==='AI_INCOMPLETE');
  await assert.rejects(readCompletedResponse(stream([delta,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),e=>e.status===429);
  await assert.rejects(readCompletedResponse(stream([{type:'response.incomplete'}])),e=>e.code==='AI_INCOMPLETE');
  await assert.rejects(readCompletedResponse(stream([null])),e=>e.code==='AI_INVALID_OUTPUT');
  assert.equal((await readCompletedResponse(stream([delta,complete]))).status,'completed');
});

async function temporary(run){const prefix=join(tmpdir(),'konspekt-tests-');const directory=await mkdtemp(prefix);try{await run(directory);}finally{if(!resolve(directory).startsWith(resolve(prefix)))throw new Error('Unexpected test path');await rm(directory,{recursive:true,force:true});}}
test('credential storage survives restart; Windows stores ciphertext and stable host ID',()=>temporary(async directory=>{
  const store=await createLocalStore(directory);const data={version:1,activeId:'fixture',accounts:[{id:'fixture',accessToken:'fixture-only-sensitive-value',name:'Қазақша Русский'}]};await store.save(data);
  const reopened=await createLocalStore(directory);assert.equal(store.hostId,reopened.hostId);assert.deepEqual(await reopened.load(),data);
  if(process.platform==='win32'){const encrypted=await readFile(join(directory,'accounts.dpapi'),'utf8');assert.ok(!encrypted.includes(data.accounts[0].accessToken));assert.ok(!encrypted.startsWith('{'));}
}));
test('local HTTP requires correct Host, Origin, cookie and CSRF; credentials never reach browser',()=>temporary(async directory=>{
  await writeFile(join(directory,'index.html'),'<!doctype html><title>Fixture</title>');const f=await fixture();
  const app=await startLocalServer({port:0,connection:f.manager,staticDirectory:directory,dataDirectory:directory});
  try{
    const get=await fetch(`${app.origin}/api/ai/status`);assert.equal(get.status,200);const status=await get.json();const cookie=get.headers.get('set-cookie').split(';')[0];assert.match(get.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(status.configured,false);assert.equal(get.headers.get('cache-control'),'no-store');
    const headers={'Content-Type':'application/json',Cookie:cookie,Origin:app.origin,'X-Konspekt-CSRF':status.csrfToken};
    const post=(path,body='{}',extra={})=>fetch(app.origin+path,{method:'POST',headers:{...headers,...extra},body});
    assert.equal((await post('/api/account/sign-in','{}',{Origin:'https://evil.example'})).status,403);
    assert.equal((await post('/api/account/sign-in','{}',{'X-Konspekt-CSRF':'wrong'})).status,403);
    assert.equal((await post('/api/account/sign-in','{}',{Cookie:''})).status,403);
    assert.equal((await post('/api/account/sign-in','{}',{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post('/api/account/sign-in','not json')).status,400);
    assert.equal((await post('/api/questions',JSON.stringify({text:'x'.repeat(650001)}))).status,413);
    const wrongHostStatus=await new Promise((resolveStatus,reject)=>{const request=httpRequest(`${app.origin}/api/ai/status`,{headers:{Host:'evil.example'},agent:false},response=>{response.resume();resolveStatus(response.statusCode);});request.on('error',reject);request.end();});
    assert.equal(wrongHostStatus,403);
    assert.equal((await fetch(`${app.origin}/.local-data/accounts.dpapi`)).status,404);
    assert.equal((await fetch(`${app.origin}/local/server.mjs`)).status,404);
    assert.equal((await fetch(`${app.origin}/`)).status,200);
    const login=await post('/api/account/sign-in');assert.equal(login.status,200);assert.equal(new URL((await login.json()).redirectURL).origin,ISSUER);
    assert.equal((await post('/api/questions',JSON.stringify({}))).status,403);
  }finally{await app.close();}
}));
