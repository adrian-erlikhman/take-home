// Optional: Claude, with the user's own API key, for two jobs the rules can't do.
// 1. Sort the lines of a letter with an unusual layout. Every line Claude
//    returns must appear in the letter word for word, or it is dropped.
// 2. Translate the plan. Each line of the translation must carry the same
//    numbers as that line of the plan, or the translation is rejected.
// Claude never decides a dose or a time; the page's own rules do that.

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

async function ask({ key, model, system, user, max = 4000 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`Claude returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.content.map((c) => c.text || '').join('');
}

export const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ''));
// Case, spacing and punctuation don't count; words and numbers do. "1,000" and
// "1.5" stay whole, so "1" or "15" can't pass for them.
const squash = (s) => String(s).toLowerCase().replace(/(\d)[.,](?=\d)/g, '$1_').replace(/[^a-z0-9_]+/g, ' ').trim();
// Whole words only: "take 1 tablet" is not inside "take 1 tablets".
const within = (part, whole) => !!part && ` ${whole} `.includes(` ${part} `);

// Keep only items whose whole line, word for word, is in the source text.
export function verifyItems(items, source) {
  const hay = squash(source);
  const nums = new Set(numbersIn(source));
  const kept = [], dropped = [];
  for (const it of items) {
    const text = it.line || '';
    const okText = within(squash(text), hay);
    const okNums = numbersIn(text).every((n) => nums.has(n));
    (okText && okNums ? kept : dropped).push(it);
  }
  return { kept, dropped };
}

export async function readWithClaude({ key, model, text }) {
  const system = 'You copy hospital discharge instructions into sections. You never add, change, or infer anything. Copy each line exactly as written.';
  const user = `Sort every instruction line from the letter below into one of these sections: medications, followup, call_911, call_doctor, diet, activity, wound, other. Return only JSON: {"items":[{"section":"...","line":"exact text from the letter"}]}. Copy each line word for word, including every number. If a line fits nowhere, use "other".\n\n<letter>\n${text}\n</letter>`;
  const out = await ask({ key, model, system, user });
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  return verifyItems(json.items || [], text);
}

// The translation must carry exactly the same numbers as the plan, line by
// line, so a number can't move from one medicine to another.
export function sameNumbers(a, b) {
  const lines = (s) => String(s).split('\n').filter((l) => l.trim());
  const key = (l) => numbersIn(l).sort().join(' ');
  const x = lines(a), y = lines(b);
  return x.length === y.length && x.every((l, i) => key(l) === key(y[i]));
}

export async function translate({ key, model, text, language }) {
  const system = 'You translate patient instructions into plain, warm language at a 6th-grade reading level. You never change, add or drop a number, a medicine name, a time, or a dose.';
  const user = `Translate this plan into ${language}. Keep every line, every number and every medicine name exactly. Return only the translation.\n\n${text}`;
  const out = (await ask({ key, model, system, user })).trim();
  if (!sameNumbers(text, out)) return { ok: false, text: out, why: 'The translation changed, dropped or added a number, so it was thrown out.' };
  return { ok: true, text: out };
}

// Answers come only from the papers, with the line they came from. If the quote
// isn't in the papers word for word, or the answer has a number the quoted
// line doesn't, the answer isn't shown.
export function checkAnswer(ans, source) {
  if (!ans || /NOT IN PAPERS/i.test(ans.answer || '')) return { ok: false, why: "Your papers don't say. Ask your care team or pharmacist." };
  // The quote has to be a real piece of the papers: three words or more, or a
  // whole line (like "You faint"). An empty or one-word quote proves nothing.
  const q = squash(ans.quote || '');
  const wholeLine = String(source).split('\n').some((l) => squash(l) === q);
  const quoteOk = within(q, squash(source)) && (q.split(' ').length >= 3 || wholeLine);
  const nums = new Set(numbersIn(ans.quote));
  const numsOk = numbersIn(ans.answer).every((n) => nums.has(n));
  if (!quoteOk || !numsOk) return { ok: false, why: "Claude's answer couldn't be matched to your papers word for word, so it isn't shown. Ask your care team." };
  return { ok: true, answer: ans.answer, quote: ans.quote };
}

export async function askPapers({ key, model, text, question }) {
  const system = 'You answer questions about a patient\'s discharge instructions using only those instructions, in plain language. You never add medical advice, doses or facts that are not in the instructions. If the instructions do not answer the question, the answer is exactly NOT IN PAPERS.';
  const user = `<papers>\n${text}\n</papers>\n\nQuestion: ${question}\n\nReturn only JSON: {"answer":"1 to 3 short sentences","quote":"the line from the papers that answers it, copied word for word"}. If the papers don't answer it, return {"answer":"NOT IN PAPERS","quote":""}.`;
  const out = await ask({ key, model, system, user, max: 800 });
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  return checkAnswer(json, text);
}

// A photo of printed papers. The text can't be checked against a source, so the
// page puts it in the box for the person to compare with their paper first.
export async function transcribePhoto({ key, model, base64, mediaType }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Transcribe this page of hospital discharge instructions exactly, line by line, keeping headings on their own lines. Do not fix, summarize or add anything. If a word is unreadable, write [unreadable]. Return only the text.' },
    ] }] }),
  });
  if (!r.ok) throw new Error(`Claude returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).content.map((c) => c.text || '').join('').trim();
}
