import assert from 'node:assert/strict';
import { parseInstructions, parseMed, frequency } from '../js/parse.js';
import { timesFor, daySchedule, checksFor, grade, icsFor, planText, doseText } from '../js/plan.js';
import { glossaryFor } from '../js/glossary.js';
import { verifyItems, sameNumbers, numbersIn, checkAnswer } from '../js/ai.js';
import { SAMPLES } from '../js/samples.js';

let n = 0;
const test = (name, fn) => { fn(); n++; };
const heart = parseInstructions(SAMPLES[0].text);
const surgery = parseInstructions(SAMPLES[1].text);
const iso = (d) => d.toISOString().slice(0, 10);

test('header', () => {
  assert.equal(heart.info.patient, 'Rosa Delgado');
  assert.equal(iso(heart.info.discharged), '2026-11-10');
  assert.match(surgery.info.reason, /appendectomy/);
});

test('medicines and their status', () => {
  assert.deepEqual(heart.meds.map((m) => [m.status, m.name]), [
    ['new', 'Furosemide'], ['new', 'Potassium chloride ER'], ['changed', 'Metoprolol succinate ER'],
    ['continue', 'Lisinopril'], ['continue', 'Atorvastatin'], ['stop', 'Ibuprofen']]);
  const perc = surgery.meds[0];
  assert.equal(perc.strength, '5-325 mg');
  assert.deepEqual(perc.dose, { min: 1, max: 2, unit: 'tablet' });
  assert.ok(perc.prn);
  assert.equal(perc.reason, 'severe pain');
  assert.deepEqual(perc.max, { n: 8, unit: 'tablet', per: '24 hours' });
  assert.equal(surgery.meds[2].days, 5);
  assert.equal(surgery.meds[3].whileTaking, 'oxycodone');
});

test('frequencies', () => {
  assert.deepEqual(frequency('take 1 PO QHS'), { perDay: 1, when: 'bedtime' });
  assert.deepEqual(frequency('twice a day'), { perDay: 2 });
  assert.deepEqual(frequency('every 8 hours'), { every: 8 });
  assert.deepEqual(frequency('q6h'), { every: 6 });
  assert.deepEqual(frequency('once daily in the morning'), { perDay: 1, when: 'morning' });
});

test('more ways to write how often', () => {
  const t = (s, prefs) => timesFor(parseMed(`X 10 mg - Take 1 tablet ${s}.`), prefs);
  assert.deepEqual(t('three times daily'), [8, 14, 20]);
  assert.deepEqual(t('by mouth 2 times a day'), [8, 20]);
  assert.deepEqual(t('four times daily'), [8, 12, 16, 20]);
  assert.deepEqual(t('in the morning and at bedtime'), [8, 22], 'two doses, not one');
  assert.deepEqual(t('with breakfast and dinner'), [8, 18]);
  assert.deepEqual(t('four times a day', { wake: 12, bed: 22 }), [12, 15, 19, 22], 'doses stay in the waking day');
  assert.deepEqual(frequency('every 4-6 hours as needed'), { every: 4 });
  assert.deepEqual(frequency('q4-6h PRN'), { every: 4 });
  assert.deepEqual(frequency('every other day'), { perDay: 1, everyDays: 2 });
  assert.deepEqual(frequency('once a week'), { perDay: 1, everyDays: 7 });
  const weekly = parseInstructions('MEDICATIONS\nAlendronate 70 mg - Take 1 tablet once a week.');
  assert.equal(daySchedule(weekly.meds).length, 0, 'a weekly medicine is not a daily dose');
  assert.match(icsFor(weekly), /RRULE:FREQ=DAILY;INTERVAL=7;COUNT=5/);
});

test('daily times', () => {
  const t = (s) => timesFor(parseMed(s));
  assert.deepEqual(t('X 10 mg - Take 1 tablet by mouth daily.'), [8]);
  assert.deepEqual(t('X 10 mg - Take 1 tablet BID.'), [8, 20]);
  assert.deepEqual(t('X 10 mg - Take 1 tablet every 6 hours.'), [0, 6, 12, 18]);
  assert.deepEqual(t('X 10 mg - Take 1 tablet every 8 hours.'), [6, 14, 22]);
  assert.deepEqual(t('X 10 mg - Take 1 tablet at bedtime.'), [22]);
  assert.deepEqual(t('X 10 mg - Take 1 tablet every 6 hours as needed.'), []);
  assert.deepEqual(timesFor(parseMed('X 10 mg - Take 1 tablet BID.'), { wake: 6, bed: 21 }), [6, 18]);
  const day = daySchedule(heart.meds);
  assert.deepEqual(day.map((s) => s.hour), [8, 22]);
  assert.equal(day[0].meds.length, 4);
  assert.equal(daySchedule(surgery.meds).at(-1).hour, 0, 'overnight doses go last');
});

test('dose text', () => {
  assert.equal(doseText(surgery.meds[0]), '1 to 2 tablets (5-325 mg)');
  assert.equal(doseText(heart.meds[0]), '1 tablet (40 mg)');
});

test('amounts as papers write them', () => {
  const d = (s) => doseText(parseMed(s));
  assert.equal(d('Warfarin 5 mg - Take 1/2 tablet by mouth daily.'), '1/2 tablet (5 mg)', 'not 1 tablet');
  assert.equal(d('Warfarin 5 mg - Take half a tablet by mouth daily.'), '1/2 tablet (5 mg)');
  assert.equal(d('Furosemide 40 mg - Take one tablet by mouth daily.'), '1 tablet (40 mg)');
  assert.equal(d('Colchicine .6 mg - Take 1 tablet daily.'), '1 tablet (0.6 mg)', 'not 6 mg');
  assert.equal(d('Acetaminophen 1,000 mg - Take 1,000 mg every 8 hours as needed.'), '1,000 mg');
  assert.equal(d('Insulin glargine 100 units/mL - Inject 10 units under the skin at bedtime.'), '10 units (100 units/mL)', 'the dose, not the concentration');
  assert.equal(d('Albuterol 90 mcg/actuation inhaler - Inhale 2 puffs every 4 hours as needed.'), '2 puffs (90 mcg/actuation)');
  assert.equal(d('Nicotine 21 mg/24 hr patch - Apply 1 patch daily.'), '1 patch (21 mg/24 hr)');
  const mixed = parseMed('Gabapentin 300 mg - Take 1 capsule in the morning and 2 capsules at bedtime.');
  assert.equal(mixed.dose, null, 'one amount cannot stand for both doses');
  assert.deepEqual(timesFor(mixed), [8, 22]);
});

test('follow-ups get dates', () => {
  assert.deepEqual(heart.followups.map((f) => [f.who, iso(f.date), f.by]), [
    ['Cardiology clinic with Dr. Patel', '2026-11-17', false], ['Blood test (BMP)', '2026-11-17', false], ['Primary care with Dr. Nguyen', '2026-11-24', true]]);
  assert.equal(heart.followups[0].phone, '555-0142');
});

test('warnings are split', () => {
  assert.equal(heart.er.length, 4);
  assert.equal(heart.call.length, 4);
  assert.equal(surgery.callPhone, '555-0177');
});

test('rules get end dates', () => {
  const lift = surgery.rules.find((r) => /lifting/.test(r.text));
  assert.ok(lift.dont); assert.equal(iso(lift.until), '2026-12-07');
  const shower = surgery.rules.find((r) => /shower/.test(r.text));
  assert.ok(!shower.dont); assert.equal(iso(shower.from), '2026-11-11');
  assert.equal(surgery.rules.find((r) => /drive/.test(r.text)).while, 'oxycodone');
});

test('no medicine drops out of the plan', () => {
  const p = parseInstructions('MEDICATIONS\nHOLD: Lisinopril 10 mg - until you see your doctor.\nVitamin D 1,000 units - Take 1 tablet.\nSTOP: Aspirin[EC] 81 mg');
  const text = planText(p, daySchedule(p.meds));
  assert.match(text, /On hold for now: Lisinopril/);
  assert.match(text, /No time written: Vitamin D, 1 tablet \(1,000 units\)/);
  assert.match(text, /Stop taking Aspirin\[EC\]/);
  const asks = checksFor(p).map((c) => c.title);
  assert.ok(asks.includes('Lisinopril is on hold'));
  assert.ok(asks.includes('Vitamin D: no time of day written'));
});

test('pharmacist questions', () => {
  const s = checksFor(surgery).map((c) => c.title);
  assert.ok(s.includes('Two of your medicines contain acetaminophen'));
  assert.ok(s.includes('Acetaminophen: no daily limit written'));
  assert.ok(!s.some((t) => /Oxycodone-acetaminophen: no daily limit/.test(t)), 'Percocet has a limit');
  const h = checksFor(heart).map((c) => c.title);
  assert.ok(h.some((t) => /Stopped: Ibuprofen/.test(t)));
  assert.ok(!h.some((t) => /acetaminophen/i.test(t)));
  const both = parseInstructions('MEDICATIONS\nSTOP: Lisinopril.\nCONTINUE: Lisinopril 10 mg - Take 1 tablet daily.');
  assert.ok(checksFor(both).some((c) => /both stop and take/.test(c.title)));
});

test('the plan reads easier than the papers', () => {
  for (const p of [heart, surgery]) {
    const before = grade(SAMPLES[p === heart ? 0 : 1].text), after = grade(planText(p, daySchedule(p.meds)));
    assert.ok(after < before, `${after} < ${before}`);
  }
});

test('glossary', () => {
  const g = glossaryFor(SAMPLES[0].text).map((x) => x.term);
  for (const t of ['PO', 'QHS', 'CHF', 'BMP', 'mEq', 'exacerbation']) assert.ok(g.includes(t), t);
  assert.ok(!glossaryFor('take it with food').some((x) => x.term === 'PO'), 'lowercase po inside words is not PO');
});

test('calendar file', () => {
  const ics = icsFor(surgery);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261123/);
  assert.match(ics, /SUMMARY:Cephalexin: 1 capsule \(500 mg\)/);
  assert.match(ics, /RRULE:FREQ=DAILY;COUNT=7/);
  assert.ok(!/Oxycodone/.test(ics.split('BEGIN:VEVENT').filter((e) => /RRULE/.test(e)).join('')), 'as-needed medicines get no reminders');
});

test('Claude lines must be in the letter', () => {
  const src = SAMPLES[0].text;
  const { kept, dropped } = verifyItems([
    { section: 'medications', line: 'NEW: Furosemide (Lasix) 40 mg tablet - Take 1 tablet by mouth once daily in the morning.' },
    { section: 'medications', line: 'NEW: Furosemide (Lasix) 80 mg tablet - Take 1 tablet by mouth once daily.' },
    { section: 'medications', line: 'Aspirin 81 mg daily' },
  ], src);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 2);
});

test('translations keep every number', () => {
  assert.ok(sameNumbers('8:00 AM: Furosemide, 1 tablet (40 mg).', '8:00 AM: Furosemida, 1 tableta (40 mg).'));
  assert.ok(!sameNumbers('8:00 AM: Furosemide, 1 tablet (40 mg).', '8:00 AM: Furosemida, 1 tableta (4 mg).'));
  assert.deepEqual(numbersIn('2,000 mg and 101.5 F'), ['2000', '101.5']);
});

test('answers must quote the papers', () => {
  const src = SAMPLES[1].text;
  assert.ok(checkAnswer({ answer: 'No. You should not drive while you take oxycodone.', quote: 'Do not drive while taking oxycodone.' }, src).ok);
  assert.ok(!checkAnswer({ answer: 'Yes, after 3 days.', quote: 'You may drive after 3 days.' }, src).ok, 'invented quote');
  assert.ok(!checkAnswer({ answer: 'Take 3 tablets every 6 hours.', quote: 'Take 2 tablets PO every 6 hours as needed for mild pain.' }, src).ok, 'number not in papers');
  assert.ok(!checkAnswer({ answer: 'NOT IN PAPERS', quote: '' }, src).ok);
});

console.log(`${n} tests passed`);
