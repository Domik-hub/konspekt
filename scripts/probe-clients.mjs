// Readiness only: no sign-in, model prompt, credential reads, or paid requests.
import { resolve } from 'node:path';
import { AIConnections } from '../local/ai-connections.mjs';
import { acpClient, runClient } from '../local/provider-process.mjs';
import { qwenAccountServer } from '../local/qwen-account.mjs';
import { deepseekWorkerArgs, parseDeepseekResult } from '../local/deepseek-account.mjs';
const root=resolve(import.meta.dirname,'..');
const manager=new AIConnections({root,dataDirectory:resolve(root,'.local-data')});
await manager.init();
for(const id of ['claude','gemini','grok','qwen','deepseek']){
  const options=await manager.options(id);
  if(id==='claude'){
    const result=await runClient(options.command,['auth','status'],{...options,timeoutMs:20000});
    const status=JSON.parse(result.stdout);
    console.log(JSON.stringify({provider:id,installed:true,authMethod:status.authMethod}));
  }else if(id==='qwen'){
    const server=await qwenAccountServer(options);
    try{const state=await server.call('/auth/subscription?paywallScene=cli');console.log(JSON.stringify({provider:id,installed:true,enabled:state.enabled,signedIn:state.signedIn}));}finally{server.close();}
  }else if(id==='deepseek'){
    const result=await runClient(process.execPath,deepseekWorkerArgs(root,'status'),{...options,timeoutMs:30000});
    console.log(JSON.stringify({provider:id,installed:true,...parseDeepseekResult(result)}));
  }else{
    const args=id==='gemini'?[...manager.geminiArgs(options.directory),'--acp']:[...manager.grokArgs(),'agent','stdio'];
    const rpc=acpClient(options.command,[...options.prefix,...args],{...options,timeoutMs:20000});
    try{const init=await rpc.request('initialize',{protocolVersion:1,clientInfo:{name:'konspekt',version:'1.0.0'},clientCapabilities:{}});console.log(JSON.stringify({provider:id,installed:true,methods:init.authMethods?.map(item=>item.id)}));}
    finally{rpc.close();}
  }
}
