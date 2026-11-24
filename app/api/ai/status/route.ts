import { aiConfig, apiError, apiJSON, authorizeAI } from "../../../../lib/ai-runtime";
export async function GET(request:Request){try{await authorizeAI(request,"status");return apiJSON({configured:Boolean(aiConfig().apiKey)});}catch(error){return apiError(error);}}
