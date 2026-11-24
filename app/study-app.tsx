"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, GraduationCap, Layers3, Loader2, LockKeyhole, Menu, Plus, Search, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, Upload, X, Zap } from "lucide-react";
import { DEMO_TEXT, generateQuestions, wordCount, type Attempt, type Difficulty, type Format, type Language, type Material, type Question, type StudySet } from "../lib/questions";
import { readLecture } from "../lib/read-file";
import { aiRequest, setLocalCSRF } from "../lib/ai-client";
import Quiz from "./quiz";
import { type ConnectionStatus } from "./chatgpt-account";
import AIConnections from "./ai-connections";
import { prepareStudySet } from "../lib/answer-options";

type View = "create" | "library" | "progress" | "set" | "quiz" | "cards";
const STORE = "konspekt-study-v1";
const difficultyNames = { easy: "Базовый", medium: "Средний", hard: "Продвинутый" };
const languageNames = { ru: "Русский", kk: "Қазақша", en: "English" };
const dateLabel = (date: string) => new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

function PaperArt() {
  return <div className="paper-art" aria-hidden="true"><div className="art-orbit"/><div className="paper paper-back"><span/><span/><span/></div><div className="paper paper-front"><div className="paper-icon"><FileText size={24}/></div><span className="paper-line long"/><span className="paper-line"/><span className="paper-line short"/><div className="paper-check"><Check size={13}/><span/></div></div><span className="art-spark"><Sparkles size={19}/></span><span className="art-dot dot-one"/><span className="art-dot dot-two"/><span className="art-plus">+</span></div>;
}

export default function StudyApp({ runtime = "sites" }: { runtime?:"sites"|"local" }) {
  const [connection, setConnection] = useState<ConnectionStatus|null>(null);
  const [view, setView] = useState<View>("create");
  const [tab, setTab] = useState<"files" | "text">("files");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [format, setFormat] = useState<Format>("mixed");
  const [mode, setMode] = useState<"ai" | "local">("ai");
  const [language, setLanguage] = useState<Language>("ru");
  const [aiStatus, setAIStatus] = useState<"checking" | "ready" | "missing" | "error">("checking");
  const [aiStatusMessage, setAIStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sets, setSets] = useState<StudySet[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [active, setActive] = useState<StudySet | null>(null);
  const [search, setSearch] = useState("");
  const [showAnswers, setShowAnswers] = useState(false);
  const [help, setHelp] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = (tab === "text" ? text.trim().length >= 80 : materials.length > 0) && !loading && !generating && (mode === "local" || aiStatus === "ready");
  const totalWords = wordCount(tab === "text" ? text : materials.map(m => m.text).join(" "));
  const providerName = runtime === "local" ? connection?.providers?.find(item=>item.id===connection.provider)?.name || "ChatGPT" : "OpenAI";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "null");
      const savedLanguage = localStorage.getItem("konspekt-question-language");
      if (runtime === "local") {
        const draft = JSON.parse(sessionStorage.getItem("konspekt-login-draft") || "null");
        if (draft) { if (typeof draft.text === "string") setText(draft.text); if (typeof draft.title === "string") setTitle(draft.title); if (["text","files"].includes(draft.tab)) setTab(draft.tab); if (Array.isArray(draft.materials)) setMaterials(draft.materials); if ([5,10,15,20].includes(draft.count)) setCount(draft.count); if (["easy","medium","hard"].includes(draft.difficulty)) setDifficulty(draft.difficulty); if (["open","choice","mixed"].includes(draft.format)) setFormat(draft.format); sessionStorage.removeItem("konspekt-login-draft"); }
      }
      if (savedLanguage === "ru" || savedLanguage === "kk" || savedLanguage === "en") setLanguage(savedLanguage);
      if (saved) {
        if (Array.isArray(saved.sets)) {
          const restored: StudySet[] = saved.sets.filter((s: StudySet) => s.id && typeof s.title === "string" && Array.isArray(s.questions) && s.questions.every(q => q.id && q.prompt && q.answer && q.source && Array.isArray(q.options))).slice(0, 20).map(prepareStudySet);
          setSets(restored);
          try { localStorage.setItem(STORE, JSON.stringify({...saved, sets:restored})); } catch { /* The upgraded order still works for this session. */ }
        }
        if (Array.isArray(saved.attempts)) setAttempts(saved.attempts.filter((a: Attempt) => a.id && a.total > 0 && a.at).slice(0, 100));
      }
    } catch { setNotice("Не удалось прочитать сохранённые материалы. Новая тренировка всё равно доступна."); }
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { void checkAI(); }, []);

  async function checkAI() {
    setAIStatus("checking");
    try {
      const response = await fetch("/api/ai/status", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(runtime === "local" ? 65000 : 10000) });
      const data = await response.json() as ConnectionStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось проверить подключение.");
      if (runtime === "local") { setConnection(data); setLocalCSRF(data.csrfToken || ""); if (data.notice) setNotice(data.notice); }
      setAIStatus(data.configured ? "ready" : "missing");
      setAIStatusMessage(data.configured ? "Вопросы по смыслу и проверка своими словами" : runtime === "local" ? data.connectionError || "Войди в выбранный ИИ в блоке выше." : "Нейросеть ещё не подключена. Пока доступен локальный режим.");
    } catch (e) {
      setAIStatus("error");
      setAIStatusMessage(e instanceof Error && !e.message.includes("JSON") ? e.message : "Не удалось проверить подключение. Обновите страницу или попробуйте ещё раз.");
    }
  }

  function rememberDraft() {
    try { sessionStorage.setItem("konspekt-login-draft", JSON.stringify({text,title,tab,materials,count,difficulty,format})); }
    catch { /* Login remains available if browser storage is full. */ }
  }
  function persist(newSets: StudySet[], newAttempts: Attempt[]) {
    try { localStorage.setItem(STORE, JSON.stringify({ sets: newSets, attempts: newAttempts })); }
    catch { setNotice("Память браузера заполнена. Этот набор доступен до закрытия страницы — скачайте вопросы, чтобы сохранить их."); }
  }
  function chooseLanguage(next: Language) {
    setLanguage(next);
    try { localStorage.setItem("konspekt-question-language", next); } catch { /* The selected language still works for this session. */ }
  }
  function navigate(next: View) { setView(next); setSidebar(false); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openSet(set: StudySet) { setActive(set); setShowAnswers(false); navigate("set"); }

  async function upload(files: FileList | File[]) {
    if (loading) return;
    setError("");
    const incoming = Array.from(files);
    if (incoming.length + materials.length > 5) { setError("Можно добавить до 5 файлов в один набор."); return; }
    setLoading(true);
    try {
      const read: Material[] = [];
      for (const file of incoming) read.push(await readLecture(file));
      const combined = [...materials, ...read];
      if (combined.reduce((n,m) => n + m.text.length, 0) > 120000) throw new Error("Общий объём больше 120 000 символов. Создайте отдельные наборы для разных лекций.");
      setMaterials(combined);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось прочитать файл. Попробуйте вставить его текст."); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function generate(demo = false) {
    if (generating) return;
    setError(""); setGenerating(true);
    // Give the progress state a paint before synchronous text analysis.
    await new Promise(resolve => setTimeout(resolve, 150));
    try {
      const source: Material[] = demo ? [{ name: "Как работает память · пример", text: DEMO_TEXT }] : tab === "files" ? materials : [{ name: title.trim() || "Текст лекции", text }];
      if (source.some(m => m.text.length > 120000)) throw new Error("Сократите материал до 120 000 символов.");
      const useAI = !demo && mode === "ai";
      const result = useAI ? await aiRequest<{title:string;note:string;questions:Question[]}>("/api/questions", { materials:source, count, format, difficulty, language }) : null;
      if (useAI && (!result || !Array.isArray(result.questions) || !result.questions.length)) throw new Error("Нейросеть не вернула вопросы. Повторите запрос.");
      const questions = useAI ? result!.questions : generateQuestions(source, demo ? 5 : count, demo ? "mixed" : format, demo ? "medium" : difficulty);
      const set = prepareStudySet({ id: crypto.randomUUID(), title: demo ? "Как работает память" : title.trim() || result?.title || (tab === "files" ? materials[0]?.name.replace(/\.[^.]+$/, "") : text.trim().split(/\n|[.!?]/)[0].slice(0, 65)) || "Новая лекция", createdAt: new Date().toISOString(), questions, words: source.reduce((n,m) => n + wordCount(m.text), 0), difficulty: demo ? "medium" : difficulty, sourceNames: source.map(m=>m.name), generatedBy:useAI ? "ai" : "local", language:useAI ? language : "ru" });
      const updated = [set, ...sets].slice(0, 20);
      setSets(updated); persist(updated, attempts); openSet(set);
      if (result?.note) setNotice(result.note);
      else if (!demo && questions.length < count) setNotice(`Получилось ${questions.length} вопросов без повторов. Для ${count} вопросов добавьте больше материала.`);
      else if (!demo && format === "choice" && questions.some(q => q.kind === "open")) setNotice("Для части вопросов мало разных вариантов в тексте — они добавлены как открытые.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не получилось создать вопросы. Проверьте текст лекции."); }
    finally { setGenerating(false); }
  }

  function finish(correct: number, total: number) {
    if (!active || !total) return;
    const updated = [{ id: crypto.randomUUID(), setId: active.id, title: active.title, at: new Date().toISOString(), correct, total }, ...attempts].slice(0, 100);
    setAttempts(updated); persist(sets, updated);
  }
  function deleteSet() {
    const updated = sets.filter(s => s.id !== deleteId);
    const scores = attempts.filter(a => a.setId !== deleteId);
    setSets(updated); setAttempts(scores); persist(updated, scores); setDeleteId(null); setNotice("Набор удалён с этого устройства.");
  }
  function download() {
    if (!active) return;
    const content = `${active.title}\n${difficultyNames[active.difficulty]} · ${active.questions.length} вопросов\n\n` + active.questions.map((q,i) => `${i+1}. ${q.prompt}\n${q.options.map((o,j)=>`${"АБВГ"[j]}. ${o}`).join("\n")}${showAnswers ? `\nОтвет: ${q.answer}\nИз лекции: ${q.source}\nИсточник: ${q.sourceName}` : ""}`).join("\n\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${active.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0,60)} — вопросы.txt`; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }
  const totalAnswered = attempts.reduce((n,a) => n+a.total, 0);
  const totalCorrect = attempts.reduce((n,a)=>n+a.correct, 0);
  const activeDays = new Set(attempts.map(a=>new Date(a.at).toLocaleDateString())).size;
  const section = view === "create" ? "Новый набор" : view === "library" ? "Мои материалы" : view === "progress" ? "Мой прогресс" : view === "cards" ? "Карточки" : view === "quiz" ? "Самопроверка" : "Вопросы по лекции";

  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={()=>setSidebar(false)}/>}
    <aside className={`sidebar ${sidebar ? "mobile-open" : ""}`}>
      <button className="brand" onClick={()=>navigate("create")} aria-label="Конспект — главная"><span className="brand-mark"><span/><span/></span><span>конспект<span className="brand-dot">.</span></span></button>
      <div className="workspace-label">ТВОЁ ПРОСТРАНСТВО</div>
      <nav className="main-nav" aria-label="Основное меню">
        <button className={view === "create" ? "active" : ""} onClick={()=>navigate("create")}><Sparkles size={19}/><span>Создать вопросы</span><Plus size={16}/></button>
        <button className={view === "library" || ["set","quiz","cards"].includes(view) ? "active" : ""} onClick={()=>navigate("library")}><FolderOpen size={19}/><span>Мои материалы</span>{sets.length > 0 && <small>{sets.length}</small>}</button>
        <button className={view === "progress" ? "active" : ""} onClick={()=>navigate("progress")}><TrendingUp size={19}/><span>Мой прогресс</span></button>
      </nav>
      <div className="sidebar-tip"><div className="tip-orb"><Zap size={21}/></div><strong>По чуть-чуть.<br/>Каждый день.</strong><p>Один небольшой тест —<br/>ещё один шаг к знаниям.</p><div className="tip-line"><span/><span/><span/><span/><span/></div></div>
      <div className="sidebar-bottom"><button className="help-link" onClick={()=>setHelp(true)}><CircleHelp size={18}/>Как это работает</button><div className="profile"><span className="avatar"><GraduationCap size={21}/></span><div><strong>Личное пространство</strong><span>Учись в своём темпе</span></div><span className="online-dot"/></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-btn" aria-label="Открыть меню" onClick={()=>setSidebar(true)}><Menu size={21}/></button><span>Рабочее пространство</span><ChevronRight size={14}/><strong>{section}</strong></div><div className="local-badge"><span/>Сохранение на устройстве</div><span className="top-avatar">К</span></header>
      <main className={`page page-${view}`}>
        {runtime === "local" && <AIConnections status={connection} busy={generating} onRefresh={checkAI} beforeSignIn={rememberDraft}/>}
        {view === "create" && <>
          <div className="intro"><div className="eyebrow"><span/>МЕНЬШЕ ПЕРЕЧИТЫВАЙ. БОЛЬШЕ ПОНИМАЙ.</div><h1>Из лекций <span className="title-arrow">↗</span> в знания.</h1><p>Загрузи материал — получи вопросы.<br className="mobile-break"/> Проверь себя и запомни главное.</p><div className="intro-doodle" aria-hidden="true"><span>твоя учёба,<br/>твой ритм</span><svg width="66" height="40" viewBox="0 0 66 40"><path d="M4 5c15 30 38 30 54 4m-13 4 15-8-2 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div></div>
          <div className="creator-grid">
            <section className="card material-card"><div className="card-heading"><div className="step-num">01</div><h2>Добавь материал</h2><span className="subtle">С этого всё начинается</span></div>
              <div className="input-tabs" role="tablist" aria-label="Способ добавления"><button role="tab" aria-selected={tab === "files"} className={tab === "files" ? "selected" : ""} onClick={()=>{setTab("files");setError("");}}><Upload size={17}/>Загрузить файл</button><button role="tab" aria-selected={tab === "text"} className={tab === "text" ? "selected" : ""} onClick={()=>{setTab("text");setError("");}}><FileText size={17}/>Вставить текст</button></div>
              <input ref={fileInput} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden-input" aria-label="Выбрать файлы лекций" onChange={e=>e.target.files && upload(e.target.files)}/>
              {tab === "files" ? <div className={`dropzone ${dragging ? "dragging" : ""} ${materials.length ? "has-files" : ""}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);upload(e.dataTransfer.files);}}>
                {materials.length === 0 ? <><PaperArt/><h3>{loading ? "Читаем твой материал…" : "Перетащи лекцию сюда"}</h3><p>или выбери файл на устройстве</p><button className="button primary upload-btn" disabled={loading} onClick={()=>fileInput.current?.click()}>{loading ? <Loader2 className="spin" size={17}/> : <Plus size={17}/>}Выбрать файл</button><div className="file-types"><span>PDF</span><span>DOCX</span><span>TXT</span><i>до 10 МБ</i></div></> : <><div className="uploaded-label"><CheckCircle2 size={18}/>Материалы готовы</div><div className="uploaded-files">{materials.map((m,i)=><div key={`${m.name}-${i}`} className="uploaded-file"><span className="file-icon"><FileText size={20}/></span><div><strong>{m.name}</strong><span>{wordCount(m.text).toLocaleString("ru-RU")} слов</span></div><button className="icon-btn" aria-label={`Убрать ${m.name}`} disabled={loading} onClick={()=>setMaterials(materials.filter((_,j)=>i!==j))}><X size={17}/></button></div>)}</div><button className="button secondary" disabled={loading || materials.length >=5} onClick={()=>fileInput.current?.click()}>{loading ? <Loader2 size={16} className="spin"/> : <Plus size={16}/>}Добавить файл</button><p className="small">До 5 файлов в одном наборе</p></>}
              </div> : <div className="text-input-wrap"><label className="sr-only" htmlFor="lecture-text">Текст лекции</label><textarea id="lecture-text" value={text} maxLength={120000} onChange={e=>setText(e.target.value)} placeholder={"Вставь сюда лекцию, конспект или главу учебника…\n\nЛучше всего подходят полные предложения с фактами и определениями."}/><div className="text-counter"><span>От 80 символов</span><span>{text.length.toLocaleString("ru-RU")} / 120 000</span></div></div>}
              <div className="privacy-note"><ShieldCheck size={15}/><span>{mode === "ai" ? `Для вопросов и проверки текст лекции и ответы передаются ${providerName}. Наборы сохраняются на этом устройстве.` : "Локальный режим: текст и ответы остаются в браузере."}</span></div>
              <div className="demo-row"><span className="demo-icon"><BookOpen size={18}/></span><div><strong>Сначала посмотреть, как это работает?</strong><p>Локальный пример «Как работает память»</p></div><button disabled={generating} onClick={()=>generate(true)}>Попробовать<ArrowRight size={16}/></button></div>
            </section>
            <section className="card settings-card"><div className="card-heading"><div className="step-num">02</div><h2>Настрой вопросы</h2><Settings2 size={18} className="settings-icon"/></div>
              <div className="ai-mode-group"><div className="field-label">Как создавать вопросы</div><div className="mode-options" role="group" aria-label="Способ создания вопросов"><button disabled={generating} aria-pressed={mode === "ai"} className={mode === "ai" ? "selected" : ""} onClick={()=>setMode("ai")}><Sparkles size={17}/>Нейросеть</button><button disabled={generating} aria-pressed={mode === "local"} className={mode === "local" ? "selected" : ""} onClick={()=>setMode("local")}>Локально</button></div>{mode === "ai" ? <div className={`ai-status ai-status-${aiStatus}`} role="status">{aiStatus === "checking" ? <Loader2 size={15} className="spin"/> : aiStatus === "ready" ? <CheckCircle2 size={15}/> : <CircleHelp size={15}/>}<span>{aiStatus === "checking" ? "Проверяем подключение…" : aiStatusMessage}</span>{["missing","error"].includes(aiStatus) && <button className="text-button" onClick={()=>void checkAI()}>Обновить</button>}</div> : <p className="setting-hint">Базовые задания по словам и определениям. Открытые ответы оцениваешь сам.</p>}</div>
              <label className="field-label" htmlFor="set-title">Название набора <span>необязательно</span></label><input id="set-title" className="text-field" placeholder="Например, Основы психологии" value={title} maxLength={100} onChange={e=>setTitle(e.target.value)}/>
              {mode === "ai" && <div className="language-setting"><div className="field-label">Язык вопросов и разбора</div><div className="language-options" role="radiogroup" aria-label="Язык вопросов и разбора">{(["ru", "kk", "en"] as Language[]).map(value => <button key={value} role="radio" aria-checked={language === value} lang={value} disabled={generating} className={language === value ? "selected" : ""} onClick={()=>chooseLanguage(value)}>{languageNames[value]}</button>)}</div><p className="setting-hint">Можно выбрать любой язык, независимо от языка лекции. Цитаты остаются в оригинале.</p></div>}
              <div className="setting-group"><div className="field-label">Количество вопросов</div><div className="count-options" role="group" aria-label="Количество вопросов">{[5,10,15,20].map(n=><button key={n} aria-pressed={count===n} className={count===n ? "selected" : ""} onClick={()=>setCount(n)}>{n}</button>)}</div></div>
              <div className="setting-group"><div className="field-label">Уровень сложности</div><div className="difficulty-options" role="group" aria-label="Сложность">{(["easy","medium","hard"] as Difficulty[]).map((d,i)=><button key={d} className={difficulty===d?"selected":""} aria-pressed={difficulty===d} onClick={()=>setDifficulty(d)}><span className={`level-bars bars-${i+1}`}><i/><i/><i/></span>{["Базовый","Средний","Высокий"][i]}</button>)}</div><p className="setting-hint">{difficulty==="easy" ? "Узнавай термины и вспоминай точные факты." : difficulty==="medium" ? "Объясняй связи, сравнения и назначение." : "Применяй знания и объясняй причины."}</p></div>
              <div className="setting-group"><div className="field-label">Формат вопросов</div><div className="format-options" role="radiogroup" aria-label="Формат вопросов">{([{value:"mixed",label:"Смешанный",desc:"Понемногу каждого формата",icon:Layers3},{value:"choice",label:"С вариантами ответа",desc:"Выбери подходящий вариант",icon:CheckCircle2},{value:"open",label:"Открытые вопросы",desc:"Вспомни и ответь самостоятельно",icon:FileText}] as const).map(item=><button role="radio" aria-checked={format===item.value} key={item.value} className={format===item.value?"selected":""} onClick={()=>setFormat(item.value)}><item.icon size={18}/><span><strong>{item.label}</strong><small>{item.desc}</small></span><i className="radio-dot"/></button>)}</div></div>
              <button className="button primary generate-btn" disabled={!ready} onClick={()=>generate()}>{generating ? <Loader2 size={18} className="spin"/> : <Sparkles size={18}/>} {generating ? "Создаём вопросы…" : "Создать вопросы"}<ArrowRight size={17}/></button><p className="generate-hint">{generating ? (mode === "ai" ? "Разбираем смысл лекции и составляем вопросы…" : "Выделяем определения и факты…") : mode === "ai" && aiStatus !== "ready" ? "Для этого режима нужно завершить подключение" : totalWords ? `${totalWords.toLocaleString("ru-RU")} слов · всё готово для старта` : "Добавь материал, чтобы начать"}</p>
            </section>
          </div>
          {error && <div className="error-message" role="alert"><CircleHelp size={18}/>{error}<button className="icon-btn" aria-label="Закрыть ошибку" onClick={()=>setError("")}><X size={16}/></button></div>}
          <div className="benefits"><div><span><Target size={20}/></span><div><strong>Только по твоей лекции</strong><p>Вопросы основаны на твоём материале</p></div></div><div><span><BookOpen size={20}/></span><div><strong>Ответы с источником</strong><p>Всегда можно вернуться к нужной мысли</p></div></div><div><span><TrendingUp size={20}/></span><div><strong>Учёба в своём темпе</strong><p>Тесты, карточки и история результатов</p></div></div></div>
          {sets.length > 0 && <section className="recent-section"><div className="section-heading"><h2>Продолжить изучение</h2><button className="text-button" onClick={()=>navigate("library")}>Все материалы<ArrowRight size={15}/></button></div><div className="recent-grid">{sets.slice(0,3).map(s=><SetCard key={s.id} set={s} open={()=>openSet(s)}/>)}</div></section>}
          <footer className="page-footer"><span>Сложное становится понятнее.</span><span>Один вопрос за раз <Sparkles size={12}/></span></footer>
        </>}

        {view === "library" && <><div className="view-heading"><div><div className="eyebrow">ТВОЯ БИБЛИОТЕКА</div><h1>Мои материалы<span className="heading-dot">.</span></h1><p>Возвращайся к лекциям, когда захочешь повторить.</p></div><button className="button primary" onClick={()=>navigate("create")}><Plus size={18}/>Новый набор</button></div><label className="search-field"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Найти по названию" aria-label="Найти материал"/></label>{sets.length ? <div className="library-grid">{sets.filter(s=>s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(s=><SetCard key={s.id} set={s} open={()=>openSet(s)} remove={()=>setDeleteId(s.id)}/>)}{!sets.some(s=>s.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <div className="empty-search">Ничего не найдено. Попробуй другое название.</div>}</div> : <EmptyState icon={<FolderOpen size={35}/>} title="Здесь будут твои лекции" text="Загрузи первый материал — и набор вопросов появится в библиотеке." action={()=>navigate("create")} label="Добавить материал"/>}<p className="storage-footnote"><LockKeyhole size={14}/>Последние 20 наборов хранятся в этом браузере. Скачивай важные вопросы перед очисткой данных.</p></>}

        {view === "progress" && <><div className="view-heading"><div><div className="eyebrow">КАЖДЫЙ ШАГ СЧИТАЕТСЯ</div><h1>Мой прогресс<span className="heading-dot">.</span></h1><p>Маленькие занятия складываются в большой результат.</p></div></div><div className="stats-grid"><Stat icon={<BookOpen/>} value={String(attempts.length)} label="Завершено тренировок"/><Stat icon={<Target/>} value={totalAnswered ? `${Math.round(totalCorrect/totalAnswered*100)}%` : "—"} label="Набрано баллов"/><Stat icon={<Zap/>} value={String(activeDays)} label="Дней с практикой"/></div>{attempts.length ? <section className="card history-card"><h2>История тренировок</h2>{attempts.map(a=><div className="history-row" key={a.id}><span className="file-icon"><CheckCircle2 size={20}/></span><div><strong>{a.title}</strong><span>{new Date(a.at).toLocaleString("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}</span></div><span className="score-pill">{a.correct} / {a.total}</span><strong className="history-percent">{Math.round(a.correct/a.total*100)}%</strong></div>)}</section> : <EmptyState icon={<TrendingUp size={35}/>} title="Первый результат — впереди" text="Пройди самопроверку по любой лекции, чтобы увидеть свой прогресс." action={()=>navigate(sets.length ? "library" : "create")} label={sets.length ? "Выбрать лекцию" : "Создать первый набор"}/>}<p className="storage-footnote">В наборах с ИИ: верный ответ — 1 балл, частичный — 0,5. В локальных наборах открытые ответы оцениваешь ты. Вопросы без оценки не входят в результат.</p></>}

        {view === "set" && active && <><button className="back-link" onClick={()=>navigate("library")}><ArrowLeft size={17}/>Мои материалы</button><div className="view-heading set-heading"><div><div className="eyebrow">ТВОЙ НАБОР ГОТОВ</div><h1>{active.title}</h1><p>{active.questions.length} вопросов <span>·</span> {difficultyNames[active.difficulty]} <span>·</span> {active.words.toLocaleString("ru-RU")} слов в материале</p></div><button className="button secondary" onClick={download}><ArrowDownToLine size={17}/>Скачать</button></div><p className="set-origin">{active.generatedBy === "ai" ? `Вопросы по смыслу · ${languageNames[active.language || "ru"]} · открытые ответы проверяет нейросеть` : "Локальный набор · для вопросов по смыслу создай новый набор из исходной лекции в режиме «Нейросеть»."}</p><div className="study-banner"><span className="study-banner-icon"><GraduationCap size={32}/></span><div><h2>Знания крепнут, когда их вспоминаешь.</h2><p>Пройди тест или повтори материал с карточками.</p></div><button className="button light" onClick={()=>navigate("cards")}><Layers3 size={17}/>Карточки</button><button className="button primary" onClick={()=>navigate("quiz")}>Проверить себя<ArrowRight size={17}/></button></div><div className="section-heading question-list-heading"><h2>Вопросы по материалу</h2><label className="toggle-label"><input type="checkbox" checked={showAnswers} onChange={e=>setShowAnswers(e.target.checked)}/><span className="switch"/>Показать ответы</label></div><div className="question-list">{active.questions.map((q,i)=><QuestionPreview key={q.id} q={q} index={i} show={showAnswers}/>)}</div></>}
        {view === "quiz" && active && <Quiz key={active.id} set={active} onBack={()=>navigate("set")} onFinish={finish}/>}
        {view === "cards" && active && <Flashcards set={active} onBack={()=>navigate("set")}/>}
      </main>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={19}/><span>{notice}</span><button className="icon-btn" aria-label="Закрыть уведомление" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {help && <div className="modal-backdrop" onClick={()=>setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e=>e.stopPropagation()}><button className="icon-btn modal-close" aria-label="Закрыть справку" autoFocus onClick={()=>setHelp(false)}><X size={21}/></button><span className="modal-symbol"><Sparkles size={26}/></span><h2 id="help-title">От лекции к пониманию</h2><ol className="help-steps"><li><strong>Добавь материал</strong><p>Загрузи PDF с текстовым слоем, DOCX, TXT или MD. Можно просто вставить текст. Сканированные страницы сначала нужно распознать.</p></li><li><strong>Создай вопросы</strong><p>В режиме «Нейросеть» вопросы проверяют понимание, связи и применение знаний. Выбери русский, казахский или английский для вопросов и разбора. Рядом с ответом есть цитата из лекции. Если материала мало, вопросов будет меньше. Локальный режим создаёт базовые задания без ИИ.</p></li><li><strong>Проверь себя</strong><p>Напиши ответ своими словами: нейросеть сверит смысл с лекцией, поставит 1, 0,5 или 0 баллов и объяснит, что исправить. В локальном режиме открытые ответы оцениваешь ты. Карточки помогают повторить материал.</p></li></ol><div className="help-note"><ShieldCheck size={18}/><span>В режиме с ИИ текст лекции и твои ответы передаются OpenAI для обработки. Наборы и результаты хранятся в этом браузере. В локальном режиме передачи нет. Проверяй объяснения по источнику: нейросеть может ошибаться.</span></div><button className="button primary full-width" onClick={()=>setHelp(false)}>Всё понятно<ArrowRight size={16}/></button></section></div>}
    {deleteId && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Удалить этот набор?</h2><p>Вопросы и связанные результаты исчезнут с этого устройства.</p><div className="modal-actions"><button className="button secondary" autoFocus onClick={()=>setDeleteId(null)}>Отмена</button><button className="button danger" onClick={deleteSet}>Удалить</button></div></section></div>}
  </div>;
}

function SetCard({set,open,remove}:{set:StudySet;open:()=>void;remove?:()=>void}) {
  return <article className="set-card"><button className="set-card-main" onClick={open}><div className="set-card-top"><span className="file-icon"><FileText size={22}/></span><span className="set-date">{dateLabel(set.createdAt)}</span></div><h3>{set.title}</h3><p>{set.questions.length} вопросов <span>·</span> {difficultyNames[set.difficulty]}</p><div className="set-card-bottom"><span>Открыть набор</span><ArrowUpRightIcon/></div></button>{remove && <button className="icon-btn delete-set" aria-label={`Удалить ${set.title}`} onClick={remove}><Trash2 size={16}/></button>}</article>;
}
function ArrowUpRightIcon(){return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function EmptyState({icon,title,text,action,label}:{icon:React.ReactNode;title:string;text:string;action:()=>void;label:string}) {return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p><button className="button primary" onClick={action}><Plus size={17}/>{label}</button></div>;}
function Stat({icon,value,label}:{icon:React.ReactNode;value:string;label:string}) {return <div className="card stat-card"><span>{icon}</span><strong>{value}</strong><p>{label}</p></div>;}
function QuestionPreview({q,index,show}:{q:Question;index:number;show:boolean}) {return <article className="card question-preview"><div className="question-meta"><span>ВОПРОС {String(index+1).padStart(2,"0")}</span><span className="kind-badge">{q.kind === "choice" ? "С вариантами" : "Открытый"}</span></div><h3>{q.prompt}</h3>{q.kind === "choice" && <div className="preview-options">{q.options.map((o,j)=><div key={o} className={show && o === q.answer ? "correct" : ""}><span>{"АБВГ"[j]}</span>{o}{show && o===q.answer && <Check size={16}/>}</div>)}</div>}{show && <div className="answer-box"><strong>Ответ: {q.answer}</strong>{q.explanation && <p>{q.explanation}</p>}<blockquote>{q.source}</blockquote><span><FileText size={13}/>{q.sourceName}</span></div>}</article>;}


function Flashcards({set,onBack}:{set:StudySet;onBack:()=>void}) {
  const [index,setIndex]=useState(0); const [flipped,setFlipped]=useState(false); const q=set.questions[index];
  function move(step:number){setIndex((index+step+set.questions.length)%set.questions.length);setFlipped(false);}
  return <div className="flashcard-container"><button className="back-link" onClick={onBack}><ArrowLeft size={17}/>К вопросам</button><div className="eyebrow">ПОВТОРЯЕМ ГЛАВНОЕ</div><h1>{set.title}</h1><p>Сначала вспомни ответ, затем переверни карточку.</p><button className={`flashcard ${flipped?"flipped":""}`} onClick={()=>setFlipped(!flipped)} aria-label={flipped?"Показать вопрос":"Показать ответ"}><span className="flashcard-label">{flipped?"ОТВЕТ ИЗ ЛЕКЦИИ":"ВОПРОС"}<Layers3 size={18}/></span><strong>{flipped?q.answer:q.prompt}</strong>{flipped && <p>{q.source}</p>}<span className="flashcard-hint">Нажми, чтобы {flipped?"вернуться к вопросу":"увидеть ответ"}<span>↻</span></span></button><div className="flashcard-controls"><button className="button secondary" aria-label="Предыдущая карточка" onClick={()=>move(-1)}><ChevronLeft size={20}/></button><span>{index+1} <i>/ {set.questions.length}</i></span><button className="button secondary" aria-label="Следующая карточка" onClick={()=>move(1)}><ChevronRight size={20}/></button></div></div>;
}
