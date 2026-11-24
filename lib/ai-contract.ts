import { z } from "zod";

export const generationInput = z.object({
  materials: z.array(z.object({ name: z.string().trim().min(1).max(250), text: z.string().trim().min(40).max(120000) })).min(1).max(5),
  count: z.number().int().min(1).max(20),
  format: z.enum(["mixed", "choice", "open"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  language: z.enum(["ru", "kk", "en"]).default("ru"),
}).refine(v => v.materials.reduce((sum,m) => sum + m.text.length, 0) <= 120000, "Не больше 120 000 символов в одном наборе");

export const gradingInput = z.object({
  question: z.object({
    prompt: z.string().trim().min(5).max(1800),
    answer: z.string().trim().min(1).max(3000),
    source: z.string().trim().min(20).max(5000),
    rubric: z.array(z.string().min(1).max(500)).max(8).optional(),
  }),
  studentAnswer: z.string().trim().min(1).max(6000),
  language: z.enum(["ru", "kk", "en"]).default("ru"),
});
export type GenerationInput = z.infer<typeof generationInput>;
export type GradingInput = z.infer<typeof gradingInput>;
export type AnswerGrade = {
  verdict: "correct" | "partial" | "incorrect";
  score: 0 | 0.5 | 1;
  feedback: string;
  strengths: string[];
  missingPoints: string[];
  improvedAnswer: string;
};
