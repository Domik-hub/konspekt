import type { Material } from "./questions";

export async function readLecture(file: File): Promise<Material> {
  if (file.size > 10 * 1024 * 1024) throw new Error(`«${file.name}» больше 10 МБ. Загрузите файл поменьше.`);
  const ext = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "txt" || ext === "md") {
    const bytes = await file.arrayBuffer();
    text = new TextDecoder("utf-8").decode(bytes);
    if ((text.match(/\uFFFD/g) || []).length > 3) text = new TextDecoder("windows-1251").decode(bytes);
  } else if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = result.value;
  } else if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > 200) throw new Error("В PDF больше 200 страниц. Разделите его на несколько лекций.");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
      }
      text = pages.join("\n\n");
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") throw new Error("Этот PDF защищён паролем. Загрузите копию без пароля.");
      throw error;
    } finally { await loadingTask.destroy(); }
  } else throw new Error("Поддерживаются PDF, DOCX, TXT и MD. Для старого DOC сохраните файл в формате DOCX.");
  text = text.trim();
  if (text.length < 80) throw new Error(`В «${file.name}» слишком мало текста. Если это скан, сначала распознайте текст и вставьте его во вкладку «Текст».`);
  if (text.length > 120000) throw new Error("В материале больше 120 000 символов. Разделите лекцию на части.");
  return { name: file.name, text };
}
