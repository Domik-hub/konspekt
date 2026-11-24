"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CircleHelp, FileText, GraduationCap, Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { aiRequest } from "../lib/ai-client";
import type { AnswerGrade } from "../lib/ai-contract";
import type { StudySet } from "../lib/questions";
import { randomizeAnswerOptions } from "../lib/answer-options";

type Result = { score: 0 | 0.5 | 1 | null; answer: string; grade: AnswerGrade | null };
const labels = { correct: "Верно — 1 балл", partial: "Частично верно — 0,5 балла", incorrect: "Стоит повторить — 0 баллов" };

export default function Quiz({ set, onBack, onFinish }: { set: StudySet; onBack: () => void; onFinish: (score: number, total: number) => void }) {
  const [quizQuestions, setQuizQuestions] = useState(() => randomizeAnswerOptions(set.questions));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<AnswerGrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);
  const question = quizQuestions[index];
  const semantic = question.generatedBy === "ai" || set.generatedBy === "ai";
  const score = results.reduce((sum, result) => sum + (result.score ?? 0), 0);
  const checked = results.filter(result => result.score !== null).length;
  const skipped = results.length - checked;

  async function check() {
    if (inFlight.current || revealed || !selected.trim()) return;
    setError("");
    if (question.kind === "choice") {
      const correct = selected === question.answer;
      setGrade({ verdict: correct ? "correct" : "incorrect", score: correct ? 1 : 0, feedback: question.explanation || (correct ? "Ты выбрал верный ответ." : "Сравни выбранный вариант с ответом из лекции."), strengths: [], missingPoints: [], improvedAnswer: question.answer });
      setRevealed(true);
      return;
    }
    if (!semantic) { setRevealed(true); return; }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await aiRequest<AnswerGrade>("/api/grade", { question: { prompt: question.prompt, answer: question.answer, source: question.source, rubric: question.rubric }, studentAnswer: selected, language: set.language || "ru" }, 60000);
      if (!result || ![0, 0.5, 1].includes(result.score) || !(result.verdict in labels)) throw new Error("Не удалось прочитать оценку. Повтори проверку.");
      setGrade(result);
      setRevealed(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось проверить ответ. Попробуй ещё раз."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function next(points: Result["score"]) {
    const updated = [...results, { score: points, answer: selected, grade }];
    setResults(updated);
    if (index === set.questions.length - 1) {
      setDone(true);
      onFinish(updated.reduce((sum, result) => sum + (result.score ?? 0), 0), updated.filter(result => result.score !== null).length);
    } else {
      setIndex(index + 1); setSelected(""); setRevealed(false); setGrade(null); setError("");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (done) return <div className="quiz-container">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/>К вопросам</button>
    <div className="card result-card">
      <span className="result-icon"><GraduationCap size={43}/></span><div className="eyebrow">ЕЩЁ ОДИН ШАГ ВПЕРЁД</div>
      <h1>{checked > 0 && score === checked && !skipped ? "Отличная работа!" : "Тренировка завершена!"}</h1><p>{set.title}</p>
      <div className="result-score">{score.toLocaleString("ru-RU")}<span> / {checked}</span></div>
      <p>{checked ? `баллов · ${Math.round(score / checked * 100)}%` : "Пока нет оценённых ответов"}</p>
      <div className="result-track"><span style={{ width: `${checked ? score / checked * 100 : 0}%` }}/></div>
      <p className="result-note">{skipped ? `Без оценки: ${skipped}. Эти вопросы не учитываются в результате. ` : ""}Верный ответ — 1 балл, частичный — 0,5. Ниже — то, что полезно повторить.</p>
      <div className="result-actions"><button className="button secondary" onClick={onBack}>Все вопросы</button><button className="button primary" onClick={() => { setQuizQuestions(randomizeAnswerOptions(set.questions)); setIndex(0); setSelected(""); setRevealed(false); setGrade(null); setError(""); setResults([]); setDone(false); }}>Пройти ещё раз<ArrowRight size={16}/></button></div>
    </div>
    {set.questions.map((q, i) => results[i]?.score === 1 ? null : <article className="card question-preview review-answer" key={q.id}>
      <div className="question-meta"><span>ВОПРОС {String(i + 1).padStart(2, "0")}</span><span className="kind-badge">{results[i]?.score === null ? "Без оценки" : results[i]?.score === 0.5 ? "Частично верно" : "Повторить"}</span></div>
      <h3>{q.prompt}</h3><p><b>Твой ответ:</b> {results[i]?.answer || "—"}</p>
      {results[i]?.grade && <p>{results[i].grade!.feedback}</p>}
      <div className="answer-box"><strong>Ответ: {results[i]?.grade?.improvedAnswer || q.answer}</strong><blockquote>{q.source}</blockquote><span><FileText size={13}/>{q.sourceName}</span></div>
    </article>)}
  </div>;

  return <div className="quiz-container">
    <button className="back-link" disabled={busy} onClick={onBack}><ArrowLeft size={17}/>Выйти к вопросам</button>
    <div className="quiz-heading"><div><div className="eyebrow">ПРОВЕРЯЕМ ЗНАНИЯ</div><h1>{set.title}</h1></div><span>{index + 1} <i>/ {set.questions.length}</i></span></div>
    <div className="quiz-progress"><span style={{ width: `${index / set.questions.length * 100}%` }}/></div>
    <section className="card quiz-card" aria-busy={busy}>
      <div className="question-meta"><span>ВОПРОС {String(index + 1).padStart(2, "0")}</span><span className="kind-badge">{question.kind === "choice" ? "Выбери один ответ" : semantic ? "Проверка нейросетью" : "Самооценка"}</span></div>
      <h2>{question.prompt}</h2>
      {question.kind === "choice" ? <div className="quiz-options">{question.options.map((option, i) => <button key={option} disabled={revealed} className={`${selected === option ? "selected" : ""} ${revealed && option === question.answer ? "correct" : ""} ${revealed && selected === option && option !== question.answer ? "wrong" : ""}`} onClick={() => setSelected(option)}><span>{"АБВГ"[i]}</span><strong>{option}</strong>{revealed && option === question.answer && <CheckCircle2 size={20}/>}</button>)}</div> : <>
        <textarea className="quiz-textarea" aria-label="Твой ответ" placeholder="Объясни своими словами. Дословное совпадение не нужно…" value={selected} maxLength={6000} disabled={revealed || busy} onChange={e => setSelected(e.target.value)}/>
        <p className="answer-counter">{selected.length.toLocaleString("ru-RU")} / 6 000</p>
      </>}
      {error && <div className="error-message grading-error" role="alert"><CircleHelp size={18}/><span>{error}<small>Твой ответ остаётся на экране. Повтори проверку или продолжи без оценки.</small></span></div>}
      {busy && <p className="grading-status" role="status"><Loader2 className="spin" size={18}/>Сравниваем смысл ответа с лекцией…</p>}
      {revealed && <div className={`quiz-feedback ${grade?.verdict === "incorrect" ? "feedback-wrong" : grade?.verdict === "partial" ? "feedback-partial" : ""}`} aria-live="polite">
        <strong>{grade ? labels[grade.verdict] : "Сравни свой ответ с лекцией"}</strong>
        {grade && <p>{grade.feedback}</p>}
        {!!grade?.strengths.length && <div className="grade-points"><b>Что верно</b><ul>{grade.strengths.map((point, i) => <li key={i}>{point}</li>)}</ul></div>}
        {!!grade?.missingPoints.length && <div className="grade-points"><b>Что добавить или исправить</b><ul>{grade.missingPoints.map((point, i) => <li key={i}>{point}</li>)}</ul></div>}
        <p><b>Вариант ответа:</b> {grade?.improvedAnswer || question.answer}</p>
        <details><summary>Фрагмент лекции</summary><blockquote>{question.source}</blockquote><small>{question.sourceName}</small></details>
      </div>}
      <div className="quiz-actions">
        {!revealed ? <><span><LockKeyhole size={14}/>Ответ появится после проверки</span><div className="check-actions">{error && <button className="button secondary" disabled={busy} onClick={() => next(null)}>Без оценки</button>}<button className="button primary" disabled={!selected.trim() || busy} onClick={() => void check()}>{busy ? <Loader2 className="spin" size={17}/> : semantic && question.kind === "open" ? <Sparkles size={17}/> : null}{busy ? "Проверяем…" : error ? "Повторить проверку" : question.kind === "open" && !semantic ? "Посмотреть ответ" : "Проверить ответ"}{!busy && <ArrowRight size={17}/>}</button></div></> : grade ? <><span>{semantic && question.kind === "open" ? "Оценка по смыслу ответа" : "Ответ проверен"}</span><button className="button primary" onClick={() => next(grade.score)}>{index + 1 === set.questions.length ? "Мой результат" : "Следующий вопрос"}<ArrowRight size={17}/></button></> : <><span>Локальный режим · оцени себя:</span><div className="self-grade"><button className="button secondary" onClick={() => next(0)}>Нужно повторить</button><button className="button primary" onClick={() => next(1)}><Check size={16}/>Я ответил верно</button></div></>}
      </div>
    </section>
    <p className="quiz-bottom-note">{semantic ? "Нейросеть оценивает смысл. Сверяй объяснение с фрагментом лекции." : "Локальный набор: открытые ответы оцениваешь ты сам."}</p>
  </div>;
}
