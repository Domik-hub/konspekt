import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomizeAnswerOptions, prepareStudySet } from '../lib/answer-options.ts';

const choices = (count=20,size=4) => Array.from({length:count},(_,i)=>({id:`q${i}`,kind:'choice',prompt:`Вопрос ${i}`,answer:`Правильный ${i}`,options:[`Правильный ${i}`,...Array.from({length:size-1},(_,j)=>`Неверный ${i}-${j}`)],source:'Точный фрагмент исходной лекции',sourceName:'Лекция',rubric:['Смысл'],explanation:'Объяснение'}));
function seeded(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
test('model output with every correct answer first becomes evenly spread without changing answers',()=>{
  for(const size of [3,4])for(const count of [1,5,10,20])for(let seed=1;seed<=20;seed++){
    const original=choices(count,size);const before=structuredClone(original);const result=randomizeAnswerOptions(original,seeded(seed));
    const positions=Array(size).fill(0);
    result.forEach((question,i)=>{assert.equal(question.id,original[i].id);assert.equal(question.answer,original[i].answer);assert.deepEqual([...question.options].sort(),[...original[i].options].sort());assert.equal(question.options.filter(option=>option===question.answer).length,1);positions[question.options.indexOf(question.answer)]++;});
    assert.ok(Math.max(...positions)-Math.min(...positions)<=1);assert.deepEqual(original,before);
  }
});
test('both first and last positions remain possible; reshuffling keeps answer identity and changes order',()=>{
  const questions=choices(8);const first=randomizeAnswerOptions(questions,seeded(1));const next=randomizeAnswerOptions(first,seeded(10));
  assert.notDeepEqual(first.map(q=>q.options),next.map(q=>q.options));
  assert.equal(first.filter(q=>q.options[0]===q.answer).length,2);assert.equal(first.filter(q=>q.options[3]===q.answer).length,2);
  for(const question of next){assert.equal(question.options.filter(option=>option===question.answer).length,1);for(const option of question.options)assert.equal(option===question.answer,option.startsWith('Правильный'));}
});
test('open questions and malformed legacy choices are preserved, including Unicode and code text',()=>{
  const open={...choices(1)[0],kind:'open',options:[],answer:'Қазақша · print $7'};
  const invalid={...choices(1)[0],options:['не тот ответ']};const values=[open,invalid,...choices(5,3),...choices(5,4)];
  const result=randomizeAnswerOptions(values,seeded(6));assert.equal(result[0],open);assert.equal(result[1],invalid);assert.equal(result.length,values.length);
});
test('old sets migrate once without losing IDs, sources or other saved metadata',()=>{
  const old={id:'old-set',title:'Лекция',createdAt:'2026-11-10',questions:choices(5),words:100,difficulty:'medium',sourceNames:['Лекция'],language:'kk',generatedBy:'ai'};
  const before=structuredClone(old);const updated=prepareStudySet(old);
  assert.equal(updated.optionOrderVersion,1);assert.equal(updated.id,old.id);assert.equal(updated.language,'kk');assert.equal(prepareStudySet(updated),updated);assert.deepEqual(old,before);
  updated.questions.forEach((q,i)=>{assert.equal(q.source,old.questions[i].source);assert.equal(q.answer,old.questions[i].answer);});
});
