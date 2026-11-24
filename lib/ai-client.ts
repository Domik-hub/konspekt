let localCSRF="";
export function setLocalCSRF(value:string){localCSRF=value;}
export async function aiRequest<T>(path:string,body:unknown,timeout=195000):Promise<T>{
  let response:Response;
  try { response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",...(localCSRF?{"X-Konspekt-CSRF":localCSRF}:{})},credentials:"same-origin",body:JSON.stringify(body),signal:AbortSignal.timeout(localCSRF?Math.max(timeout,195000):timeout)}); }
  catch { throw new Error("Не удалось дождаться ответа. Проверьте подключение и попробуйте снова."); }
  let result:unknown;
  try { result=await response.json(); }
  catch { throw new Error("Сессия могла закончиться. Обновите страницу и войдите через ChatGPT."); }
  if(!response.ok) throw new Error(result && typeof result==="object" && "error" in result && typeof result.error==="string" ? result.error : "Нейросеть временно недоступна.");
  return result as T;
}
