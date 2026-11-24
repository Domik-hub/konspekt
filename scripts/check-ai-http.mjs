import assert from 'node:assert/strict';

// Run only against the local development server, with no API key configured.
const base = 'http://127.0.0.1:5173';
const anonymous = await fetch(`${base}/api/ai/status`);
assert.equal(anonymous.status, 401);
assert.equal((await anonymous.json()).code, 'SIGN_IN_REQUIRED');
const signIn = await fetch(`${base}/signin-with-chatgpt?return_to=%2F`, { redirect: 'manual' });
const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Development sign-in must issue a local test cookie');
const status = await fetch(`${base}/api/ai/status`, { headers: { cookie } });
assert.equal(status.status, 200);
assert.equal((await status.json()).configured, false, 'Stop: this test must never run with real credentials');

async function expectCode(path, body, code, responseStatus, headers = {}) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', ...headers }, body });
  assert.equal(response.status, responseStatus);
  // Vinext can reject a foreign Origin before the application handler runs.
  if (code === 'INVALID_ORIGIN' && !response.headers.get('content-type')?.includes('application/json')) return;
  const result = await response.json();
  assert.equal(result.code, code);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
const lecture = 'Working memory temporarily holds information and makes it available for solving a current task.';
const generation = JSON.stringify({ materials: [{ name: 'test.txt', text: lecture }], count: 5, difficulty: 'medium', format: 'open', language: 'kk' });
await expectCode('/api/questions', generation, 'AI_NOT_CONFIGURED', 503);
await expectCode('/api/grade', JSON.stringify({ question: { prompt: 'What is working memory?', answer: 'Temporary storage for a current task.', source: lecture }, studentAnswer: 'It keeps information for the task I am doing.', language: 'en' }), 'AI_NOT_CONFIGURED', 503);
await expectCode('/api/questions', generation, 'INVALID_ORIGIN', 403, { origin: 'https://unrelated.invalid' });
await expectCode('/api/questions', generation, 'INVALID_CONTENT_TYPE', 415, { 'content-type': 'text/plain' });
await expectCode('/api/questions', '{not json', 'INVALID_INPUT', 400);
await expectCode('/api/questions', 'x'.repeat(650001), 'INPUT_TOO_LARGE', 413);
console.log('PASS: local authentication, missing credentials, origin, content type, malformed JSON, body limit, no-store. No provider requests.');
