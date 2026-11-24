// A small composition of the official Harness packages. The native account
// provider owns login, PKCE and credentials; this worker never reads tokens.
// No agent, tools, shell, MCP, workspace discovery or user plugins are mounted.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
const requireClient=createRequire(resolve(root,'.local-tools/package.json'));
const native=async name=>import(pathToFileURL(requireClient.resolve(`@deepseek-ai/${name}`)).href);
const operation=process.argv[2];
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),operation==='login'?300000:180000);
const metadata={version:'0.2.2-rc.1',locale:'ru',timezoneOffsetSeconds:-new Date().getTimezoneOffset()*60};
let ctx;

async function mount(name,config){const module=await native(name);await ctx.plugin(module.default||module,config);}
async function chooseModel(preferred){
  await mount('dsh-llm');await mount('dsh-llm-deepseek-account');
  const models=await ctx.llm.listModels('deepseek-account');
  const model=models.find(item=>item.id===preferred)||models.find(item=>/flash/i.test(item.id))||models[0];
  if(!model)throw Object.assign(new Error(),{code:'DEEPSEEK_MODEL_UNAVAILABLE'});
  return model;
}

try{
  if(!['status','login','logout','request'].includes(operation)||!process.env.DSH_HOME)throw new Error('Invalid worker invocation');
  const {Context}=await native('cordis');ctx=new Context();
  await mount('dsh-credentials-local',{dshHome:process.env.DSH_HOME,watch:false});
  await mount('dsh-authorization');
  if(operation==='login')await mount('dsh-host-webserver',{host:'127.0.0.1',port:0});
  await mount('dsh-deepseek-account-platform',{attemptTimeoutMs:300000});
  if(operation==='status')emit({result:{connected:(await ctx.deepseekAccount.getState()).status==='credential-stored'}});
  else if(operation==='logout'){await ctx.deepseekAccount.signOut(metadata);emit({result:{ok:true}});}
  else if(operation==='login'){
    let state=await ctx.deepseekAccount.getState();let authorizationURL='';
    if(state.status!=='credential-stored')state=await ctx.deepseekAccount.startSignIn(metadata,ctx.webServer.getOrigin(),'web');
    while(state.status!=='credential-stored'){
      controller.signal.throwIfAborted();
      if(state.attempt?.authorizeUrl&&state.attempt.authorizeUrl!==authorizationURL){authorizationURL=state.attempt.authorizeUrl;emit({event:'authorization',url:authorizationURL});}
      if(['cancelled','expired','failed'].includes(state.attempt?.phase))throw Object.assign(new Error(),{code:'DEEPSEEK_LOGIN_FAILED'});
      await delay(500,undefined,{signal:controller.signal});state=await ctx.deepseekAccount.getState();
    }
    const model=await chooseModel();emit({result:{connected:true,model:model.id}});
  }else{
    if((await ctx.deepseekAccount.getState()).status!=='credential-stored')throw Object.assign(new Error(),{code:'CLIENT_AUTH_REQUIRED'});
    let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1_000_000)throw new Error('Input too large');}
    const request=JSON.parse(input);const model=await chooseModel(request.model);
    const info=await ctx.llm.resolveModelInfo('deepseek-account',model.id,controller.signal);
    const effort=info.reasoning?.efforts?.[0]?.id;
    let output='',finish;
    for await(const chunk of ctx.llm.stream({
      provider:'deepseek-account',model:model.id,
      ...(effort?{reasoningEffort:effort}:{}),
      system:request.instructions,
      messages:[{role:'user',content:[{type:'text',text:request.prompt}]}],
      tools:[],maxTokens:request.name==='lecture_questions'?16000:2400,signal:controller.signal,
    })){
      if(chunk.type==='text-delta'){output+=chunk.text;if(output.length>1_000_000)throw new Error('Output too large');}
      if(chunk.type==='finish')finish=chunk.reason;
    }
    if(finish?.kind!=='stop')throw Object.assign(new Error(),{code:finish?.failure?.code||'AI_INCOMPLETE'});
    emit({result:output});
  }
}catch(error){
  // Native diagnostics and credential values must never reach the browser.
  const known=['CLIENT_AUTH_REQUIRED','ACCOUNT_SIGN_IN_REQUIRED','ACCOUNT_TOKEN_INVALID','AUTH','RATE_LIMIT','QUOTA','ACCOUNT_QUOTA','AI_INCOMPLETE','DEEPSEEK_MODEL_UNAVAILABLE','DEEPSEEK_LOGIN_FAILED'];
  emit({error:{code:controller.signal.aborted?'AI_TIMEOUT':known.includes(error?.code)?error.code:'DEEPSEEK_REQUEST_FAILED'}});process.exitCode=1;
}finally{
  clearTimeout(timer);
  if(ctx)await ctx.fiber.dispose();
}
