import type { Question, StudySet } from "./questions.ts";

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Shuffle distractors and spread correct answers across positions, without changing question order. */
export function randomizeAnswerOptions(questions: Question[], random = Math.random): Question[] {
  const result = [...questions];
  const groups = new Map<number, number[]>();
  questions.forEach((question, index) => {
    if (question.kind !== "choice" || question.options.length < 2 || question.options.filter(option => option === question.answer).length !== 1) return;
    const group = groups.get(question.options.length) || [];
    group.push(index); groups.set(question.options.length, group);
  });
  for (const [optionCount, indices] of groups) {
    const offset = Math.floor(random() * optionCount);
    const positions = shuffled(indices.map((_, index) => (index + offset) % optionCount), random);
    indices.forEach((questionIndex, index) => {
      const question = questions[questionIndex];
      const options = shuffled(question.options.filter(option => option !== question.answer), random);
      options.splice(positions[index], 0, question.answer);
      result[questionIndex] = {...question, options};
    });
  }
  return result;
}

/** Upgrade saved sets once so previews and text exports also lose model ordering bias. */
export function prepareStudySet(set: StudySet): StudySet {
  return set.optionOrderVersion === 1 ? set : {...set, questions:randomizeAnswerOptions(set.questions), optionOrderVersion:1};
}
