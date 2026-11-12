import { parseInstructions } from './parse.js';
import { daySchedule, clock, doseText, checksFor, grade, icsFor, planText, PREFS, timesFor, everyLabel, notDaily, amount, units } from './plan.js';
import { glossaryFor } from './glossary.js';
import { MODELS, readWithClaude, translate, askPapers, transcribePhoto } from './ai.js';
import { SAMPLES } from './samples.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const state = { text: '', plan: null, prefs: { ...PREFS }, key: '', model: MODELS[0] };

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (d) => d ? `${DAY[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}` : '';
const src = (line) => line ? `<button class="src" data-line="${line}" title="Show this line on your papers">line ${line}</button>` : '';
const statusTag = (m) => ({ new: '<em class="tag new">New</em>', changed: '<em class="tag changed">Changed</em>', start: '<em class="tag new">New</em>' }[m.status] || '');

function status(msg, err = false) { const s = $('#status'); s.textContent = msg; s.className = err ? 'status err' : 'status'; }

function make(text) {
  state.text = text;
  state.plan = parseInstructions(text);
  if (!state.plan.meds.length && !state.plan.followups.length && !state.plan.er.length && !state.plan.call.length) {
    $('#plan').hidden = true;
    return status('No sections found. Keep the headings, like “Medications” and “Call your doctor if”, or try Claude below.', true);
  }
  status('');
  render();
  $('#plan').scrollIntoView({ behavior: 'smooth' });
}

function render() {
  const p = state.plan;
  const sched = daySchedule(p.meds, state.prefs);
  const asks = checksFor(p);
  const gloss = glossaryFor(state.text);
  const before = grade(state.text), after = grade(planText(p, sched));
  const day0 = p.info.discharged;
  const prn = p.meds.filter((m) => m.prn && m.status !== 'stop');
  const other = notDaily(p.meds);
  const stopped = p.meds.filter((m) => m.status === 'stop');
  const held = p.meds.filter((m) => ['hold', 'ask'].includes(m.status));
  const untimed = p.meds.filter((m) => !m.freq && !m.prn && !['stop', 'hold', 'ask'].includes(m.status));
  const dont = p.rules.filter((r) => r.dont), dos = p.rules.filter((r) => !r.dont);

  const medHow = (m) => [
    m.route, m.withFood ? 'with food' : '',
    m.days && day0 ? `for ${m.days} days, through ${fmt(new Date(day0.getTime() + (m.days - 1) * 86400000))}` : m.days ? `for ${m.days} days` : '',
    m.whileTaking ? `while you take ${m.whileTaking}` : '', m.note,
  ].filter(Boolean).join(' · ');

  $('#plan').innerHTML = `
    <div class="plan-head">
      <div><h2>Your plan at home</h2>
        <div class="who">${esc([p.info.patient, p.info.reason].filter(Boolean).join(' · '))}${day0 ? ` · went home ${fmt(day0)}` : ''}</div></div>
      <div class="plan-actions">
        <button class="btn small" data-act="print">Print for the fridge</button>
        <button class="btn small" data-act="ics">Add to my calendar</button>
      </div>
    </div>
    ${before - after >= 1 ? `<div class="reading">Reading level of your papers <b>grade ${before.toFixed(0)}</b><span class="arrow">→</span>this plan <b>grade ${after.toFixed(0)}</b></div>` : ''}
    <div class="grid">
      <div class="stack">
        <article class="card day">
          <h3>Your day</h3>
          <p class="sub">Built around waking at ${clock(state.prefs.wake)} and bed at ${clock(state.prefs.bed)}. Change those below the plan.</p>
          ${sched.map((s) => `<div class="slot"><div class="t">${clock(s.hour)}</div><div>${s.meds.map((m) => `
            <label class="med"><input type="checkbox"><span><span class="name">${esc(m.name)}</span>${statusTag(m)}
            <span class="how"> · ${esc(doseText(m))}</span>${src(m.line)}<br><span class="how">${esc(medHow(m))}</span></span></label>`).join('')}</div></div>`).join('') || '<p class="sub">No daily medicines found.</p>'}
          ${other.length ? `<div class="prn"><h4>Not every day</h4><ul>${other.map((m) => `<li><b>${esc(m.name)}</b>${statusTag(m)} · ${esc(doseText(m))}, ${everyLabel(m.freq.everyDays)} at ${timesFor(m, state.prefs).map(clock).join(' and ')}${src(m.line)}</li>`).join('')}</ul></div>` : ''}
          ${prn.length ? `<div class="prn"><h4>Only if you need it</h4><ul>${prn.map((m) => `<li><b>${esc(m.name)}</b>${statusTag(m)} · ${esc(doseText(m))}${m.reason ? ` for ${esc(m.reason)}` : ''}${m.freq?.every ? `, no more often than every ${m.freq.every} hours` : ''}${m.max ? `, at most ${amount(m.max.n)} ${esc(units(m.max.unit, m.max.n))} in 24 hours` : ''}${src(m.line)}</li>`).join('')}</ul></div>` : ''}
          ${untimed.length ? `<div class="prn"><h4>No time written</h4><ul>${untimed.map((m) => `<li><b>${esc(m.name)}</b>${statusTag(m)}${doseText(m) ? ` · ${esc(doseText(m))}` : ''}${src(m.line)}</li>`).join('')}</ul></div>` : ''}
          ${held.length ? `<div class="stopped"><h4>${held.some((m) => m.status === 'ask') ? 'Not for now' : 'On hold for now'}</h4><ul>${held.map((m) => `<li>${m.status === 'ask' ? `<b>${esc(m.name)}</b>${m.brand ? ` (${esc(m.brand)})` : ''}: ask your doctor before taking it` : esc(m.source.replace(/^HOLD\s*:\s*/i, ''))}${src(m.line)}</li>`).join('')}</ul></div>` : ''}
          ${stopped.length ? `<div class="stopped"><h4>Stop taking</h4><ul>${stopped.map((m) => `<li><b>${esc(m.name)}</b>${m.brand ? ` (${esc(m.brand)})` : ''}${src(m.line)}</li>`).join('')}</ul></div>` : ''}
        </article>
        ${asks.length ? `<article class="card asks"><h3>Ask your pharmacist</h3><p class="sub">Take Home never changes a dose. These are questions to bring.</p><ul>${asks.map((a) => `<li class="${a.level}"><b>${esc(a.title)}</b>${esc(a.text)}${a.lines.filter(Boolean).map(src).join('')}</li>`).join('')}</ul></article>` : ''}
      </div>
      <div class="stack">
        ${p.er.length ? `<article class="warn er"><h3>Call 911</h3><p class="sub">Or go to the emergency room if:</p><ul>${p.er.map((w) => `<li>${esc(w.text)}${src(w.line)}</li>`).join('')}</ul></article>` : ''}
        ${p.call.length ? `<article class="warn call"><h3>Call your doctor${p.callPhone ? ` at <span class="phone">${esc(p.callPhone)}</span>` : ''}</h3><p class="sub">If:</p><ul>${p.call.map((w) => `<li>${esc(w.text)}${src(w.line)}</li>`).join('')}</ul></article>` : ''}
        ${p.followups.length ? `<article class="card"><h3>Appointments</h3><p class="sub">Dates are counted from the day you went home. Call to confirm the exact time.</p>${p.followups.map((f) => `
          <div class="appt"><div class="date">${f.date ? `<span class="m">${f.by ? 'By ' : ''}${MONTH[f.date.getUTCMonth()]}</span><span class="d">${f.date.getUTCDate()}</span><span class="m">${DAY[f.date.getUTCDay()]}</span>` : '<span class="m">Date to set</span>'}</div>
          <div><div class="what">${esc(f.who)}</div><div class="when">${f.days != null ? `${f.by ? 'Within' : 'In'} ${f.days % 7 === 0 ? `${f.days / 7} week${f.days > 7 ? 's' : ''}` : `${f.days} days`}` : ''}${f.phone ? ` · call ${esc(f.phone)}${f.toSchedule ? ' to schedule' : ''}` : ''}${src(f.line)}</div></div></div>`).join('')}</article>` : ''}
        ${p.rules.length ? `<article class="card rules"><h3>For now</h3>${dont.length ? `<p class="sub">Don't</p><ul>${dont.map((r) => `<li>${esc(r.text)}${r.until ? ` <span class="until">until ${fmt(r.until)}</span>` : ''}${r.while ? ` <span class="until">while you take ${esc(r.while)}</span>` : ''}${src(r.line)}</li>`).join('')}</ul>` : ''}${dos.length ? `<p class="sub">Do</p><ul>${dos.map((r) => `<li>${esc(r.text)}${r.from ? ` <span class="until">from ${fmt(r.from)}</span>` : ''}${src(r.line)}</li>`).join('')}</ul>` : ''}</article>` : ''}
        ${p.unread.length ? `<article class="card rules no-print"><h3>Not in this plan</h3><p class="sub">Take Home didn't sort these lines. Read them on your papers.</p><ul>${p.unread.map((l) => `<li>${esc(l.text)}${src(l.n)}</li>`).join('')}</ul></article>` : ''}
        ${gloss.length ? `<article class="card words"><h3>Words on your papers</h3><dl class="gloss">${gloss.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.plain)}</dd>`).join('')}</dl></article>` : ''}
      </div>
    </div>
    <article class="card no-print" style="margin-top:18px">
      <h3>Ask about your papers</h3>
      <p class="sub">With Claude and your own key (set it under “Use Claude” below). Claude answers only from your papers and has to quote the line it used. If the quote isn't in your papers word for word, the answer isn't shown.</p>
      <div class="row"><input id="question" type="text" placeholder="Can I take ibuprofen for a headache?" style="flex:1;min-width:260px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;font:15px var(--sans)">
      <button class="btn small" data-act="ask" ${state.key ? '' : 'disabled title="Add your API key under Use Claude first"'}>Ask</button></div>
      <div id="answer"></div>
      <h3 style="margin-top:22px">Translate this plan</h3>
      <p class="sub">If the translation changes, adds or drops any number, it's thrown out.</p>
      <div class="row"><select id="lang">${['Spanish', 'Chinese (Simplified)', 'Vietnamese', 'Tagalog', 'Korean', 'Arabic', 'Russian', 'Haitian Creole'].map((l) => `<option>${l}</option>`).join('')}</select>
      <button class="btn small" data-act="translate" ${state.key ? '' : 'disabled title="Add your API key under Use Claude first"'}>Translate</button></div>
      <div id="translation"></div>
    </article>
    <details class="source no-print"><summary>Your papers, line by line</summary><div class="lines">${state.text.split('\n').map((l, i) => `<div id="L${i + 1}"><span>${i + 1}</span>${esc(l)}</div>`).join('')}</div></details>`;
  $('#plan').hidden = false;
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function pdfText(file) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of items) { const y = Math.round(it.transform[5] / 3) * 3; if (!rows.has(y)) rows.set(y, []); rows.get(y).push(it); }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join(' ').replace(/\s{2,}/g, ' '));
  }
  return out.join('\n');
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sample) { const s = SAMPLES.find((x) => x.id === b.dataset.sample); $('#letter').value = s.text; make(s.text); }
  if (b.id === 'make') { const t = $('#letter').value.trim(); if (!t) return status('Paste your discharge papers first.', true); make(t); }
  if (b.dataset.line) {
    const d = $('.source'); d.open = true;
    document.querySelectorAll('.lines .hit').forEach((x) => x.classList.remove('hit'));
    const row = document.getElementById('L' + b.dataset.line); row.classList.add('hit'); row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (b.dataset.act === 'print') window.print();
  if (b.dataset.act === 'ics') download('take-home-plan.ics', icsFor(state.plan, null, state.prefs), 'text/calendar');
  if (b.dataset.act === 'ask') {
    const q = $('#question').value.trim(); if (!q) return;
    const out = $('#answer'); out.innerHTML = '<p class="sub">Asking…</p>';
    try {
      const r = await askPapers({ key: state.key, model: state.model, text: state.text, question: q });
      out.innerHTML = r.ok ? `<div class="translation"><b>${esc(r.answer)}</b>\n\nFrom your papers: “${esc(r.quote)}”</div>` : `<p class="status">${esc(r.why)}</p>`;
    } catch (err) { out.innerHTML = `<p class="status err">${esc(err.message)}</p>`; }
  }
  if (b.dataset.act === 'translate') {
    const out = $('#translation'); out.innerHTML = '<p class="sub">Translating…</p>';
    try {
      const sched = daySchedule(state.plan.meds, state.prefs);
      const r = await translate({ key: state.key, model: state.model, text: planText(state.plan, sched), language: $('#lang').value });
      out.innerHTML = r.ok ? `<div class="translation">${esc(r.text)}</div>` : `<p class="status err">${esc(r.why)}</p>`;
    } catch (err) { out.innerHTML = `<p class="status err">${esc(err.message)}</p>`; }
  }
  if (b.id === 'readClaude') {
    const t = $('#letter').value.trim(); if (!t) return status('Paste your discharge papers first.', true);
    status('Claude is sorting the lines…');
    try {
      const { kept, dropped } = await readWithClaude({ key: state.key, model: state.model, text: t });
      const H = { medications: 'MEDICATIONS', followup: 'FOLLOW-UP', call_911: 'CALL 911 IF:', call_doctor: 'CALL YOUR DOCTOR IF:', diet: 'DIET', activity: 'ACTIVITY', wound: 'WOUND CARE' };
      const sorted = Object.entries(H).map(([k, h]) => { const ls = kept.filter((i) => i.section === k).map((i) => i.line); return ls.length ? [h, ...ls].join('\n') : ''; }).filter(Boolean).join('\n\n');
      const head = t.split('\n').slice(0, 6).join('\n');
      make(head + '\n\n' + sorted);
      status(`Claude sorted ${kept.length} lines${dropped.length ? `; ${dropped.length} didn't match your letter word for word and were dropped` : ''}.`);
    } catch (err) { status(err.message, true); }
  }
});

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  status('Reading the file…');
  try {
    if (/^image\//.test(f.type)) {
      if (!state.key) return status('Reading a photo needs Claude. Add your API key under “Use Claude” first.', true);
      status('Claude is reading the photo…');
      const base64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
      $('#letter').value = await transcribePhoto({ key: state.key, model: state.model, base64, mediaType: f.type });
      return status("Claude typed up the photo. Check it against your paper, fix anything that's off, then make your plan.");
    }
    $('#letter').value = /\.pdf$/i.test(f.name) ? await pdfText(f) : await f.text(); status('Loaded. Check the text, then make your plan.');
  }
  catch (err) { status(`Couldn't read that file (${err.message}).`, true); }
});

const hours = Array.from({ length: 24 }, (_, h) => h);
$('#wake').innerHTML = hours.filter((h) => h >= 4 && h <= 12).map((h) => `<option value="${h}" ${h === state.prefs.wake ? 'selected' : ''}>${clock(h)}</option>`).join('');
$('#bed').innerHTML = hours.filter((h) => h >= 19).map((h) => `<option value="${h}" ${h === state.prefs.bed ? 'selected' : ''}>${clock(h)}</option>`).join('');
for (const id of ['wake', 'bed']) $('#' + id).addEventListener('change', (e) => { state.prefs[id] = +e.target.value; if (state.plan) render(); });
$('#model').innerHTML = MODELS.map((m) => `<option>${m}</option>`).join('');
$('#model').addEventListener('change', (e) => { state.model = e.target.value; });
$('#key').addEventListener('input', (e) => {
  state.key = e.target.value.trim();
  $('#readClaude').disabled = !state.key;
  for (const t of document.querySelectorAll('[data-act="translate"], [data-act="ask"]')) { t.disabled = !state.key; t.title = state.key ? '' : 'Add your API key under Use Claude first'; }
});

const q = new URLSearchParams(location.search).get('demo');
if (q) { const s = SAMPLES.find((x) => x.id === q) || SAMPLES[0]; $('#letter').value = s.text; make(s.text); }
