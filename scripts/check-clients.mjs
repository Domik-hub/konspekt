import test from 'node:test';
import assert from 'node:assert/strict';
import { AIConnections, clientEnvironment, questionPrompt } from '../local/ai-connections.mjs';
import { parseClientResult } from '../local/provider-process.mjs';
import { qwenAuthorizationURL } from '../local/qwen-account.mjs';
import { deepseekAuthorizationURL, parseDeepseekResult } from '../local/deepseek-account.mjs';
import { createSemanticQuestions, gradeSemanticAnswer } from '../lib/ai-provider.ts';
import { startLocalServer } from '../local/server.mjs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

test('account clients cannot inherit API keys, alternate gateways, or other provider credentials',()=>{
  const base={PATH:'runtime-path',USERPROFILE:'user-profile',OPENAI_API_KEY:'do-not-inherit',ANTHROPIC_API_KEY:'do-not-inherit',GEMINI_API_KEY:'do-not-inherit',XAI_API_KEY:'do-not-inherit',DEEPSEEK_API_KEY:'do-not-inherit',DASHSCOPE_API_KEY:'do-not-inherit',QWEN_API_KEY:'do-not-inherit',ANTHROPIC_BASE_URL:'custom',GROK_MODELS_BASE_URL:'custom',DSH_PLATFORM_ORIGIN:'custom',QWEN_BASE_URL:'custom',GOOGLE_APPLICATION_CREDENTIALS:'other-account'};
  for(const id of ['claude','gemini','grok','qwen','deepseek']){
    const env=clientEnvironment(id,'isolated-profile',base);
    assert.equal(env.PATH,base.PATH);assert.equal(env.USERPROFILE,base.USERPROFILE);
    assert.ok(!JSON.stringify(env).includes('do-not-inherit'));assert.ok(!JSON.stringify(env).includes('other-account'));assert.ok(!JSON.stringify(env).includes('custom'));
  }
});

test('native account login links must stay on the provider authorization site',()=>{
  assert.equal(qwenAuthorizationURL('https://chat.qwen.ai/auth?state=one-time'),'https://chat.qwen.ai/auth?state=one-time');
  assert.equal(deepseekAuthorizationURL('https://platform.deepseek.com/dsh/authorize?state=one-time'),'https://platform.deepseek.com/dsh/authorize?state=one-time');
  for(const url of ['javascript:alert(1)','http://chat.qwen.ai/','https://chat.qwen.ai.attacker.test/','https://someone@chat.qwen.ai/'])assert.throws(()=>qwenAuthorizationURL(url));
  for(const url of ['https://platform.deepseek.com/elsewhere','https://platform.deepseek.com.attacker.test/dsh/authorize','http://platform.deepseek.com/dsh/authorize'])assert.throws(()=>deepseekAuthorizationURL(url));
});

test('DeepSeek account quotas, expired login and incomplete answers are explicit and sanitized',()=>{
  const result=body=>({code:1,stdout:JSON.stringify(body),stderr:'private-diagnostic'});
  assert.throws(()=>parseDeepseekResult(result({error:{code:'ACCOUNT_QUOTA'}})),e=>e.code==='CLIENT_RATE_LIMIT'&&e.message.includes('баланс'));
  assert.throws(()=>parseDeepseekResult(result({error:{code:'ACCOUNT_TOKEN_INVALID'}})),e=>e.code==='CLIENT_AUTH_REQUIRED');
  assert.throws(()=>parseDeepseekResult(result({error:{code:'AI_INCOMPLETE'}})),e=>!e.message.includes('private'));
  assert.deepEqual(parseDeepseekResult({code:0,stdout:'{"event":"authorization","url":"not-a-credential"}\n{"result":{"model":"fixture"}}',stderr:''}),{model:'fixture'});
});

test('Qwen accepts only a completed native transcript and its structured result',()=>{
  const native=messages=>({code:0,stdout:JSON.stringify(messages),stderr:''});
  const earlier={type:'assistant',message:{content:[{type:'text',text:'{"wrong":true}'}]}};
  assert.deepEqual(parseClientResult('qwen',native([{type:'system'},earlier,{type:'result',subtype:'success',is_error:false,structured_result:{ok:true},result:'{"ok":true}'}])),{ok:true});
  assert.throws(()=>parseClientResult('qwen',native([earlier])),e=>e.code==='AI_INVALID_OUTPUT');
  assert.throws(()=>parseClientResult('qwen',native([earlier,{type:'result',subtype:'error_max_turns',is_error:true,error:{message:'quota private'}}])),e=>e.code==='CLIENT_RATE_LIMIT'&&!e.message.includes('private'));
  assert.throws(()=>parseClientResult('qwen',native([{type:'result',subtype:'incomplete',is_error:false,result:'{"ok":true}'}])));
});

test('Qwen and DeepSeek carry study input through stdin and use the native account transport',async()=>{
  const calls=[];const root=resolve(import.meta.dirname,'..');
  const manager=new AIConnections({root,dataDirectory:root,runner:async(command,args,options)=>{
    calls.push({args,input:options.input});return {code:0,stdout:JSON.stringify({result:'{"ok":true}'}),stderr:''};
  }});
  manager.options=async()=>({command:process.execPath,prefix:['native-client'],cwd:root,env:{}});
  for(const id of ['qwen','deepseek']){
    await assert.rejects(()=>manager.request(id,{}),e=>e.code==='CLIENT_AUTH_REQUIRED');
    manager.state.connections[id]={connected:true,model:'account-model'};
    assert.deepEqual(await manager.request(id,{name:'lecture_questions',instructions:'Teach.',input:{lecture:'PRIVATE_LECTURE'},schema:{type:'object'},timeoutMs:1000}),{ok:true});
    const call=calls.at(-1);assert.ok(call.input.includes('PRIVATE_LECTURE'));assert.ok(!call.args.join(' ').includes('PRIVATE_LECTURE'));
    if(id==='qwen'){assert.ok(call.args.includes('qwen-subscription'));assert.equal(call.args[call.args.indexOf('--max-tool-calls')+1],'0');}
    else assert.ok(call.args[0].endsWith('deepseek-worker.mjs'));
  }
});

test('native client failures, refusals and non-JSON results never become study content',()=>{
  const fixtures=[{code:1,stdout:'{"result":"unauthorized sensitive-detail"}',stderr:''},{code:0,stdout:'{"is_error":true,"result":"bad"}',stderr:''},{code:0,stdout:'{"response":"I cannot provide JSON"}',stderr:''}];
  for(const result of fixtures)assert.throws(()=>parseClientResult('gemini',result),e=>!e.message.includes('sensitive-detail'));
  assert.throws(()=>parseClientResult('gemini',{code:1,stdout:'',stderr:'quota 429 private-detail'}),e=>e.code==='CLIENT_RATE_LIMIT'&&!e.message.includes('private-detail'));
  for(const [provider,field] of [['claude','result'],['gemini','response'],['grok','result']])assert.deepEqual(parseClientResult(provider,{code:0,stdout:JSON.stringify({[field]:'```json\n{"ok":true}\n```'}),stderr:''}),{ok:true});
});

test('every transport keeps semantic validation, chosen language, source grounding and grading',async()=>{
  const source='Листья растений используют свет для образования органических веществ. При фотосинтезе выделяется кислород.';
  const input={materials:[{name:'Биология',text:source}],count:1,format:'choice',difficulty:'medium',language:'kk'};
  const question={kind:'choice',prompt:'Фотосинтез кезінде өсімдік не үшін жарықты пайдаланады?',answer:'Органикалық заттарды түзу үшін',options:['Органикалық заттарды түзу үшін','Топырақты қыздыру үшін','Тамырды суыту үшін','Жел жасау үшін'],sourceIndex:0,sourceQuote:source,rubric:['Свет нужен для образования органических веществ.'],explanation:'Жарық органикалық заттардың түзілуіне қажет.'};
  const calls=[];
  const config={structured:async request=>{calls.push(request);return {title:'Фотосинтез',note:'',questions:[question]};}};
  const result=await createSemanticQuestions(input,config);
  assert.equal(result.questions[0].answer,question.answer);assert.equal(result.questions[0].source,source);
  assert.equal(calls[0].input.language,'kk');assert.ok(questionPrompt(calls[0]).includes(JSON.stringify(input)));
  await assert.rejects(()=>createSemanticQuestions(input,{structured:async()=>({title:'Wrong',note:'',questions:[{...question,sourceQuote:'Этой цитаты нет в предоставленной лекции.'}]})}),e=>e.code==='AI_UNGROUNDED_OUTPUT');
  await assert.rejects(()=>createSemanticQuestions({...input,language:'bad'},config),e=>e.code==='INVALID_INPUT');
  assert.equal(calls.length,1);
  const grade=await gradeSemanticAnswer({question:{prompt:question.prompt,answer:question.answer,source},studentAnswer:'Для образования органических веществ',language:'en'},{structured:async request=>{
    assert.equal(request.input.language,'en');
    return {verdict:'partial',feedback:'Partly correct.',strengths:['Formation of organic substances.'],missingPoints:['Mention light.'],improvedAnswer:'Leaves use light to form organic substances.'};
  }});
  assert.equal(grade.score,0.5);
});

test('HTTP choice persists, protects mutations, and routes both tasks only to selected provider',async()=>{
  const root=resolve(import.meta.dirname,'..');
  const base=resolve(root,'.local-data');const directory=resolve(base,`client-test-${crypto.randomUUID()}`);
  await mkdir(directory,{recursive:true});
  let chatgptCalls=0;
  const chatgpt={state:{activeId:'fixture'},init:async()=>{},stopActive:()=>{},status:async()=>({configured:true,account:null,accounts:[],models:[],connectionError:''}),inferenceConfig:async()=>{chatgptCalls++;return {authMode:'chatgpt'};}};
  const connections=new AIConnections({root,dataDirectory:directory});
  const respond=async(input,config)=>({route:config.structured?'external':'chatgpt'});
  let app;
  try{
    app=await startLocalServer({port:0,dataDirectory:directory,connection:chatgpt,connections,generate:respond,grade:respond});
    const status=await fetch(`${app.origin}/api/ai/status`);const session=await status.json();
    const headers={'content-type':'application/json',origin:app.origin,cookie:status.headers.get('set-cookie').split(';')[0],'x-konspekt-csrf':session.csrfToken};
    const post=(path,body,options={})=>fetch(`${app.origin}${path}`,{method:'POST',headers:{...headers,...options},body:JSON.stringify(body)});
    assert.equal((await post('/api/questions',{})).status,200);assert.equal(chatgptCalls,1);
    assert.equal((await post('/api/providers/select',{id:'gemini'},{'x-konspekt-csrf':'wrong'})).status,403);
    assert.equal(connections.state.active,'chatgpt');
    assert.equal((await post('/api/providers/select',{id:'../../anything'})).status,400);
    for(const id of ['gemini','claude','grok','qwen','deepseek']){
      assert.equal((await post('/api/providers/select',{id})).status,200);
      for(const path of ['/api/questions','/api/grade'])assert.deepEqual(await (await post(path,{})).json(),{route:'external'});
    }
    assert.equal(chatgptCalls,1,'external providers never fall back to the ChatGPT account');
    const restored=new AIConnections({root,dataDirectory:directory});await restored.init();assert.equal(restored.state.active,'deepseek');
  }finally{await app?.close();if(directory.startsWith(base+sep))await rm(directory,{recursive:true,force:true});}
});
