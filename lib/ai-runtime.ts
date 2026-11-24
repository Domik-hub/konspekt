import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { AIError, DEFAULT_MODEL } from "./ai-provider";

export function aiConfig() { return {apiKey:env.OPENAI_API_KEY || "",model:env.OPENAI_MODEL || DEFAULT_MODEL}; }
const requests=new Map<string,{count:number;reset:number}>();
export async function authorizeAI(request:Request, purpose:"generate"|"grade"|"status") {
  const user=await getChatGPTUser();
  if(!user) throw new AIError("Войдите через ChatGPT, чтобы пользоваться нейросетью.",401,"SIGN_IN_REQUIRED");
  if(purpose==="status") return;
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin) throw new AIError("Запрос отклонён. Откройте сайт и повторите действие.",403,"INVALID_ORIGIN");
  if(!request.headers.get("content-type")?.includes("application/json")) throw new AIError("Ожидался текстовый запрос.",415,"INVALID_CONTENT_TYPE");
  const key=`${purpose}:${user.userId}`;
  const now=Date.now();
  for(const [id,value] of requests) if(value.reset<now) requests.delete(id);
  const window=requests.get(key) || {count:0,reset:now+60000};
  if(window.count >= (purpose==="generate"?6:45)) throw new AIError("Слишком много запросов подряд. Подождите минуту.",429,"AI_RATE_LIMIT");
  window.count++; requests.set(key,window);
}
export async function boundedJSON(request:Request):Promise<unknown> {
  const max=650000;
  if(Number(request.headers.get("content-length") || 0)>max) throw new AIError("Слишком большой материал. Разделите лекцию на части.",413,"INPUT_TOO_LARGE");
  if(!request.body) throw new AIError("Добавьте текст лекции.",400,"INVALID_INPUT");
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new AIError("Слишком большой материал. Разделите лекцию на части.",413,"INPUT_TOO_LARGE");}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new AIError("Не удалось прочитать запрос. Повторите действие.",400,"INVALID_INPUT");}
}
export function apiJSON(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
export function apiError(error:unknown){return error instanceof AIError?apiJSON({error:error.message,code:error.code},error.status):apiJSON({error:"Не удалось выполнить запрос. Попробуйте позже.",code:"INTERNAL_ERROR"},500);}
