"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { aiRequest } from "../lib/ai-client";
import ChatGPTAccount, {type ConnectionStatus} from "./chatgpt-account";
import "./ai-connections.css";

const help:Record<string,{text:string;url:string}>={
  claude:{text:"Войди в аккаунт Claude с доступом к Claude Code. Используется лимит твоего плана Claude.",url:"https://claude.ai/settings/usage"},
  gemini:{text:"Войди через Google. Действуют лимиты Gemini CLI для твоего Google-аккаунта.",url:"https://geminicli.com/docs/resources/quota-and-pricing/"},
  grok:{text:"Войди в аккаунт Grok с доступом к Grok Build. Действуют лимиты твоего аккаунта.",url:"https://grok.com/"},
  qwen:{text:"Нужен аккаунт с подпиской Qwen Plus или Pro. Используется лимит этой подписки; API-ключ не нужен.",url:"https://chat.qwen.ai/"},
  deepseek:{text:"Вход через DeepSeek Harness без API-ключа. Запросы расходуют его баланс или бонусы. Бесплатный чат DeepSeek не даёт безлимитного доступа здесь.",url:"https://platform.deepseek.com/usage"},
};

export default function AIConnections({status,busy,onRefresh,beforeSignIn}:{status:ConnectionStatus|null;busy:boolean;onRefresh:()=>Promise<void>;beforeSignIn:()=>void}){
  const [working,setWorking]=useState(false);const [error,setError]=useState("");
  const refresh=useRef(onRefresh);refresh.current=onRefresh;
  const provider=status?.provider||"chatgpt";
  const selected=status?.providers?.find(item=>item.id===provider);
  const connecting=Boolean(status?.providers?.some(item=>item.connecting));
  useEffect(()=>{
    if(!connecting)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){await refresh.current();if(!stopped)timer=setTimeout(poll,2000);}
    timer=setTimeout(poll,2000);
    return()=>{stopped=true;clearTimeout(timer);};
  },[connecting]);
  async function action(path:string,id=provider){
    if(working||busy)return;
    setWorking(true);setError("");
    try{await aiRequest(`/api/providers/${path}`,{id});await onRefresh();}
    catch(e){setError(e instanceof Error?e.message:"Не удалось изменить подключение.");}
    finally{setWorking(false);}
  }
  return <div className="ai-connections">
    <div className="ai-provider-heading"><label htmlFor="ai-provider"><Sparkles size={17}/>Какой ИИ использовать</label><span>Для вопросов и проверки ответов</span></div>
    <div className="ai-provider-tabs" role="group" aria-label="Выбор ИИ">
      {(status?.providers||[{id:"chatgpt",name:"ChatGPT",installed:true}]).map(item=><button key={item.id} type="button" aria-pressed={provider===item.id} disabled={busy||working||!status?.csrfToken} onClick={()=>void action("select",item.id)} className={provider===item.id?"selected":""}><span className={`ai-provider-mark mark-${item.id}`}>{item.name[0]}</span>{item.name}{item.connected&&<CheckCircle2 size={14}/>}</button>)}
    </div>
    {provider==="chatgpt"?<ChatGPTAccount status={status?.chatgpt ? {...status.chatgpt,csrfToken:status.csrfToken}:status} busy={busy||working} onRefresh={onRefresh} beforeSignIn={beforeSignIn}/>:<section className="chatgpt-card" aria-label={`Подключение ${selected?.name||provider}`}>
      <div className="chatgpt-intro"><span className="chatgpt-symbol">{status?.configured?<CheckCircle2 size={22}/>:<Sparkles size={22}/>}</span><div><strong>{status?.configured?`${selected?.name} подключён`:`Подключи ${selected?.name}`}</strong><p>{help[provider]?.text}</p></div><span className="on-device-label">Без API-ключа</span></div>
      <div className="chatgpt-actions">
        {!selected?.installed?<p className="account-warning">Подключение пока не установлено на этом компьютере.</p>:selected.connecting?<><Loader2 className="spin" size={18}/><span>{selected.authorizationURL?"Открой страницу входа и вернись сюда после подтверждения.":`Готовим вход ${selected.name}. Если открылась страница сервиса, заверши вход там.`}</span>{selected.authorizationURL&&<a className="button primary" href={selected.authorizationURL} target="_blank" rel="noreferrer">Открыть страницу входа<ExternalLink size={16}/></a>}<button type="button" className="text-button" disabled={working} onClick={()=>void action("cancel")}>Отменить вход</button></>:<>
          <button type="button" className="button primary" disabled={busy||working||connecting} onClick={()=>void action("connect")}>{working?<Loader2 className="spin" size={17}/>:<ExternalLink size={16}/>} {status?.configured?"Обновить вход":`Войти в ${selected?.name}`}</button>
          {status?.configured&&<button type="button" className="account-icon-button" title={`Отключить ${selected?.name}`} aria-label={`Отключить ${selected?.name}`} disabled={busy||working} onClick={()=>void action("disconnect")}><LogOut size={18}/></button>}
          <button type="button" className="text-button" disabled={working||busy} onClick={()=>void onRefresh()}>Обновить статус</button>
        </>}
      </div>
      {selected?.error&&<p className="account-warning" role="alert">{selected.error}</p>}
      <div className="chatgpt-footer"><span><ShieldCheck size={14}/>Вход на странице сервиса · свой аккаунт и свои лимиты</span><a href={help[provider]?.url} target="_blank" rel="noreferrer">Аккаунт и лимиты<ExternalLink size={12}/></a></div>
    </section>}
    {error&&<p className="account-warning" role="alert">{error}</p>}
  </div>;
}
