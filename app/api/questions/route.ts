import { createSemanticQuestions } from "../../../lib/ai-provider";
import { aiConfig, apiError, apiJSON, authorizeAI, boundedJSON } from "../../../lib/ai-runtime";
export async function POST(request:Request){try{await authorizeAI(request,"generate");const input=await boundedJSON(request);return apiJSON(await createSemanticQuestions(input,aiConfig()));}catch(error){return apiError(error);}}
