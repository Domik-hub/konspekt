"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { aiRequest } from "../lib/ai-client";
import "./chatgpt-account.css";

type Account = { id:string; email:string; name:string; label:string; signedIn:boolean; planEnabled:boolean; model:string; welcomeSeen:boolean };
export type ProviderStatus = {id:string;name:string;client?:string;installed:boolean;connected?:boolean;connecting?:boolean;error?:string;authorizationURL?:string};
export type ConnectionStatus = { configured:boolean; csrfToken?:string; account:Account|null; accounts:Account[]; models:{slug:string;name:string}[]; connectionError:string; notice?:string; provider?:string; providers?:ProviderStatus[]; chatgpt?:ConnectionStatus|null };
const usageURL = "https://chatgpt.com/settings/usage";

export default function ChatGPTAccount({ status, busy:parentBusy, onRefresh, beforeSignIn }: { status:ConnectionStatus|null; busy:boolean; onRefresh:()=>Promise<void>; beforeSignIn:()=>void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [welcomeClosed, setWelcomeClosed] = useState<string|null>(null);
  const busy = working || parentBusy;
  const account = status?.account;

  async function action(path:string, body:object = {}) {
    if (busy) return;
    setWorking(true); setError(""); setMessage("");
    try {
      const result = await aiRequest<{redirectURL?:string;revoked?:boolean}>(`/api/account/${path}`, body, 60000);
      if (result.redirectURL) { beforeSignIn(); window.location.assign(result.redirectURL); return; }
      if (path === "sign-out") setMessage(result.revoked ? "Аккаунт отключён от приложения." : "Выход выполнен на этом компьютере. Отзыв доступа на стороне ChatGPT не подтверждён — отключи приложение в настройках ChatGPT.");
      await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось подключить ChatGPT."); }
    finally { setWorking(false); }
  }
  const signIn = (newAccount = false) => action("sign-in", { ...(!newAccount && account ? { accountId:account.id } : {}), enablePlan:Boolean(!newAccount && account?.signedIn && !account.planEnabled) });
  const welcome = Boolean(account?.planEnabled && !account.welcomeSeen && account.id !== welcomeClosed);

  return <>
    <section className="chatgpt-card" aria-label="Подключение ChatGPT">
      <div className="chatgpt-intro"><span className="chatgpt-symbol"><Sparkles size={22}/></span><div><strong>{status?.configured ? "Используется подписка ChatGPT" : "Учись с подпиской ChatGPT"}</strong><p>{status?.configured ? "Вопросы по смыслу лекции и проверка твоих ответов" : "Подключи свой аккаунт, чтобы создавать вопросы с нейросетью."}</p></div><span className="on-device-label">На этом компьютере</span></div>
      {!status ? <div className="chatgpt-actions"><span>Проверяем подключение…</span><button type="button" className="text-button" onClick={()=>void onRefresh()}>Обновить</button></div> : <>
        <div className="chatgpt-actions">
          {status.accounts.length > 0 && <label className="account-field"><span>Аккаунт ChatGPT</span><select aria-label="Аккаунт ChatGPT" value={account?.id || ""} disabled={busy} onChange={e=>void action("select",{id:e.target.value})}>{status.accounts.map(item=><option value={item.id} key={item.id}>{item.email || item.name || "ChatGPT"} · {item.label}{item.signedIn ? "" : " · нужен вход"}</option>)}</select></label>}
          {status.models.length > 0 && <label className="account-field model-field"><span>Модель</span><select aria-label="Модель ChatGPT" value={account?.model || ""} disabled={busy} onChange={e=>void action("model",{model:e.target.value})}>{status.models.map(model=><option value={model.slug} key={model.slug}>{model.name}</option>)}</select></label>}
          {!status.configured && <button type="button" className="chatgpt-signin" data-oai-siwc-button disabled={busy || !status.csrfToken} onClick={()=>void signIn()}>{working ? <Loader2 size={17} className="spin"/> : null}Continue with ChatGPT</button>}
          {account?.signedIn && <button type="button" className="account-icon-button" title="Выйти из ChatGPT в приложении" aria-label="Выйти из ChatGPT в приложении" disabled={busy} onClick={()=>void action("sign-out")}><LogOut size={18}/></button>}
        </div>
        {account?.signedIn && !account.planEnabled && <p className="account-warning">Аккаунт подключён, но использование подписки ещё не разрешено. Нажми Continue with ChatGPT и предоставь разрешение.</p>}
        {status.connectionError && <p className="account-warning" role="alert">{status.connectionError}</p>}
        <div className="chatgpt-footer"><span><ShieldCheck size={14}/>{account?.planEnabled ? "Действуют лимиты твоей подписки" : "Вход на странице OpenAI · без API-ключа"}</span><div>{status.accounts.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={()=>void signIn(true)}>Добавить аккаунт</button>}{account?.signedIn && status.configured && <button type="button" className="text-button" disabled={busy} onClick={()=>void signIn()}>Обновить вход</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>void onRefresh()}>Обновить статус</button><a href={usageURL} target="_blank" rel="noreferrer">Управление лимитами<ExternalLink size={12}/></a></div></div>
      </>}
      {error && <p className="account-warning" role="alert">{error}</p>}
      {message && <p className="account-message" role="status">{message}</p>}
    </section>
    {welcome && account && <div className="modal-backdrop"><section className="modal chatgpt-welcome" role="dialog" aria-modal="true" aria-labelledby="chatgpt-welcome-title"><span className="modal-symbol"><CheckCircle2 size={27}/></span><h2 id="chatgpt-welcome-title">Используется подписка ChatGPT</h2><p>Теперь «Конспект» может создавать вопросы по смыслу лекции и проверять твои ответы. Запросы расходуют доступный лимит подписки.</p><p>Разрешения приложения и лимиты можно изменить в ChatGPT. Лекции и ответы отправляются OpenAI только при работе с нейросетью.</p><a className="button secondary full-width" href={usageURL} target="_blank" rel="noreferrer">Управление лимитами<ExternalLink size={16}/></a><button type="button" autoFocus className="button primary full-width" onClick={()=>{setWelcomeClosed(account.id);void action("welcome");}}>Понятно, начнём</button></section></div>}
  </>;
}
