import { gradeSemanticAnswer } from "../../../lib/ai-provider";
import { aiConfig, apiError, apiJSON, authorizeAI, boundedJSON } from "../../../lib/ai-runtime";
export async function POST(request:Request){try{await authorizeAI(request,"grade");const input=await boundedJSON(request);return apiJSON(await gradeSemanticAnswer(input,aiConfig()));}catch(error){return apiError(error);}}
