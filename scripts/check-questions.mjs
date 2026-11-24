import assert from 'node:assert/strict';
import { generateQuestions, DEMO_TEXT, wordCount } from '../lib/questions.ts';

const demo = [{ name: 'memory.txt', text: DEMO_TEXT }];
let cases = 0;
for (const format of ['mixed', 'choice', 'open']) {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const questions = generateQuestions(demo, 10, format, difficulty, 42);
    assert.equal(questions.length, 10);
    assert.equal(new Set(questions.map(q => q.source)).size, questions.length);
    for (const q of questions) {
      assert.ok(DEMO_TEXT.includes(q.source));
      assert.ok(q.source.includes(q.answer), `Answer must be grounded: ${q.answer}`);
      assert.equal(q.sourceName, 'memory.txt');
      if (q.kind === 'choice') {
        assert.ok(q.options.length >= 3 && q.options.length <= 4);
        assert.equal(q.options.filter(option => option === q.answer).length, 1);
        assert.equal(new Set(q.options).size, q.options.length);
      }
      if (format === 'open') assert.equal(q.kind, 'open');
    }
    cases++;
  }
}
const small = [{ name: 'short.txt', text: 'Гиппокамп играет важную роль в формировании новых воспоминаний. Внимание помогает отбирать информацию для дальнейшей обработки и запоминания.' }];
assert.equal(generateQuestions(small, 20, 'mixed', 'medium', 1).length, 2);
assert.throws(() => generateQuestions([{ name: 'empty', text: 'Короткий заголовок' }], 10, 'mixed', 'medium'), /материала/);
assert.throws(() => generateQuestions([{ name: 'repeat', text: `${small[0].text.split('. ')[0]}. `.repeat(10) }], 10, 'mixed', 'medium'), /материала/);
const english = [{ name: 'english.txt', text: 'Photosynthesis is the process by which plants convert light energy into chemical energy. Chlorophyll is the green pigment that absorbs light during photosynthesis. Mitochondria generate energy for the cell through cellular respiration.' }];
assert.equal(generateQuestions(english, 5, 'mixed', 'medium', 2).length, 3);
assert.equal(wordCount('Один два три. Four five.'), 5);
console.log(`PASS: ${cases} format/difficulty combinations, source grounding, unique answers, short input, deduplication, English input.`);
