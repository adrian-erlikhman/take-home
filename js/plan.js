// Turns parsed instructions into a day plan, safety questions, a readability
// score and a calendar file. Nothing here changes a dose: it only arranges
// what the paper says and asks questions about it.

export const PREFS = { wake: 8, bed: 22 };

// ---------- daily times ----------
export function timesFor(med, prefs = PREFS) {
  const f = med.freq;
  if (!f || med.prn || ['stop', 'hold', 'ask'].includes(med.status)) return [];
  const { wake, bed } = prefs;
  if (f.every) {
    if (f.every >= 24) return [wake];
    const start = f.every >= 12 ? wake : 6;
    return Array.from({ length: Math.round(24 / f.every) }, (_, k) => (start + k * f.every) % 24).sort((a, b) => a - b);
  }
  const n = f.perDay;
  if (n === 1) return [f.when === 'bedtime' ? bed : f.when === 'evening' ? 18 : wake];
  if (n === 2 && f.when) return [wake, f.when === 'bedtime' ? bed : 18];
  if (n === 3 && med.withFood && wake <= 9) return [wake, 12, 18];
  if (n >= 2 && n <= 4) {
    // Spread the doses over the waking day: 8, 20 / 8, 14, 20 / 8, 12, 16, 20.
    const last = Math.min(wake + 12, bed);
    return Array.from({ length: n }, (_, k) => Math.round(wake + (k * (last - wake)) / (n - 1)));
  }
  return [];
}

// Medicines taken every day, by hour. Every-other-day and weekly medicines are
// listed on their own so they don't look like daily doses.
export function daySchedule(meds, prefs = PREFS) {
  const slots = new Map();
  for (const m of meds) for (const h of m.freq?.everyDays ? [] : timesFor(m, prefs)) {
    if (!slots.has(h)) slots.set(h, []);
    slots.get(h).push(m);
  }
  return [...slots.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([hour, meds]) => ({ hour, meds }));
}
const order = (h) => (h < 5 ? h + 24 : h); // overnight doses go last

export const everyLabel = (n) => (n === 2 ? 'every other day' : n === 7 ? 'once a week' : `every ${n} days`);
export const notDaily = (meds) => meds.filter((m) => m.freq?.everyDays && !m.prn && !['stop', 'hold', 'ask'].includes(m.status));

export const clock = (h) => {
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:00 ${h % 24 < 12 ? 'AM' : 'PM'}`.replace('12:00 AM', '12:00 midnight').replace('12:00 PM', '12:00 noon');
};

// 0.5 prints as 1/2 and 1000 as 1,000, the way papers write them.
export function amount(n) {
  const whole = Math.floor(n), part = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[+(n - whole).toFixed(2)];
  if (part) return whole ? `${whole} ${part}` : part;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
const COUNTED = /^(tablet|tab|capsule|cap|puff|drop|patch|spray|teaspoon|tablespoon|unit|dose|packet|suppository|lozenge)$/;
export const units = (unit, n) => (n > 1 && COUNTED.test(unit) ? (unit === 'patch' ? 'patches' : unit === 'suppository' ? 'suppositories' : `${unit}s`) : unit);

export function doseText(m) {
  if (!m.dose) return m.strength;
  const n = m.dose.min === m.dose.max ? amount(m.dose.min) : `${amount(m.dose.min)} to ${amount(m.dose.max)}`;
  const u = m.dose.unit ? ` ${units(m.dose.unit, m.dose.max)}` : '';
  return `${n}${u}${m.strength && m.strength !== n + u ? ` (${m.strength})` : ''}`;
}

// ---------- questions for the pharmacist ----------
const APAP = /acetaminophen|\bAPAP\b|tylenol|percocet|norco|vicodin|lortab|endocet|ultracet|excedrin|nyquil|dayquil/i;
const NSAID = /ibuprofen|advil|motrin|naproxen|aleve|ketorolac|toradol|meloxicam|mobic|celecoxib|celebrex|diclofenac|aspirin/i;

export function checksFor(plan) {
  const active = plan.meds.filter((m) => !['stop', 'hold', 'ask'].includes(m.status));
  const stopped = plan.meds.filter((m) => m.status === 'stop');
  const label = (m) => m.name + (m.brand ? ` (${m.brand})` : '');
  const out = [];

  const apap = active.filter((m) => APAP.test(m.name + ' ' + m.brand));
  if (apap.length > 1) out.push({
    level: 'ask', title: 'Two of your medicines contain acetaminophen',
    text: `${apap.map(label).join(' and ')} both contain acetaminophen (Tylenol). The FDA's limit for adults is 4,000 mg of acetaminophen a day from all medicines combined. Ask your pharmacist how much of each you can take in one day.`,
    lines: apap.map((m) => m.line),
  });

  const nsaid = active.filter((m) => NSAID.test(m.name + ' ' + m.brand));
  if (nsaid.length > 1) out.push({
    level: 'ask', title: 'Two pain relievers of the same kind (NSAIDs)',
    text: `${nsaid.map(label).join(' and ')} are both NSAIDs. Ask your pharmacist whether you should take them together.`,
    lines: nsaid.map((m) => m.line),
  });

  for (const s of stopped) {
    const words = (s.name + ' ' + s.brand).split(/[\s,]+/).filter((w) => w.length > 3).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const still = active.find((m) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(m.name + ' ' + m.brand)));
    if (still) out.push({ level: 'ask', title: `${s.name} is listed as both stop and take`, text: `Your papers say to stop ${s.name}, but also list ${label(still)}. Ask which is right.`, lines: [s.line, still.line] });
    if (NSAID.test(s.name + ' ' + s.brand)) out.push({
      level: 'know', title: `Stopped: ${s.name}. Check other labels too`,
      text: `Many cold, flu and pain medicines contain ${s.name.toLowerCase()} or other NSAIDs${s.brand ? ` (${s.brand})` : ''}. Read the "Active ingredients" on anything you buy.`,
      lines: [s.line],
    });
  }

  for (const m of active) {
    if (m.prn && !m.max) out.push({ level: 'ask', title: `${m.name}: no daily limit written`, text: `It says "as needed" but not how many you can take in a day. Ask how many is the most in 24 hours.`, lines: [m.line] });
    if (!m.freq && !m.prn) out.push({ level: 'ask', title: `${m.name}: no time of day written`, text: `The papers don't say how often to take it. Ask before your first dose at home.`, lines: [m.line] });
    if (/as directed/i.test(m.source)) out.push({ level: 'ask', title: `${m.name}: "as directed"`, text: `"As directed" isn't written down anywhere you can check later. Ask for the directions in writing.`, lines: [m.line] });
  }
  for (const m of plan.meds.filter((x) => x.status === 'hold')) out.push({ level: 'ask', title: `${m.name} is on hold`, text: `Ask when to start taking it again, and who will tell you.`, lines: [m.line] });
  for (const m of plan.meds.filter((x) => x.status === 'ask')) out.push({ level: 'ask', title: `${m.name}: ask before you take it`, text: `Your papers list it under "ask your doctor". Ask whether to keep taking it.`, lines: [m.line] });
  return out;
}

// ---------- readability (Flesch-Kincaid grade) ----------
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
export function grade(text) {
  const sentences = text.split(/[.!?:\n]+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!sentences.length || !words.length) return 0;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return Math.max(0, 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59);
}

// ---------- calendar ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

// RFC 5545: lines of at most 75 bytes; longer ones continue on a line that starts with a space.
const bytes = (c) => new TextEncoder().encode(c).length;
function fold(line) {
  const out = [];
  let cur = '', n = 0;
  for (const c of line) {
    if (n + bytes(c) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += c; n += bytes(c);
  }
  return [...out, cur].join('\r\n ');
}

export function icsFor(plan, start, prefs = PREFS) {
  const ev = [];
  // UIDs must differ between files, or a calendar replaces one plan's events with the next one's.
  const file = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let uid = 0;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]|\.\d+/g, '');
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); // the local date
  for (const f of plan.followups) if (f.date) ev.push([
    'BEGIN:VEVENT', `UID:${file}-${uid++}@take-home`, `DTSTAMP:${stamp}`,
    ...(f.time ? [`DTSTART:${ymd(f.date)}T${pad(f.time.h)}${pad(f.time.m)}00`, 'DURATION:PT1H'] : [`DTSTART;VALUE=DATE:${ymd(f.date)}`]),
    `SUMMARY:${esc((f.by ? 'By today: ' : '') + f.who)}`,
    `DESCRIPTION:${esc(`From your discharge papers: "${f.source}"`)}`, 'END:VEVENT']);
  for (const m of plan.meds) for (const h of timesFor(m, prefs)) {
    const d = start || plan.info.discharged || today;
    const every = m.freq.everyDays || 1;
    const count = Math.ceil((m.days || 30) / every);
    ev.push(['BEGIN:VEVENT', `UID:${file}-${uid++}@take-home`, `DTSTAMP:${stamp}`,
      `DTSTART:${ymd(d)}T${pad(h)}0000`, `DURATION:PT10M`, `RRULE:FREQ=DAILY;${every > 1 ? `INTERVAL=${every};` : ''}COUNT=${count}`,
      `SUMMARY:${esc(`${m.name}: ${m.mixed ? 'check the amount on your papers' : doseText(m)}`)}`, `DESCRIPTION:${esc(`From your discharge papers: "${m.source}"`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(m.name)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT']);
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Take Home//EN', 'CALSCALE:GREGORIAN', ...ev.flat(), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

// ---------- the plan as plain text (for reading level and translation) ----------
export function planText(plan, schedule) {
  const lines = [];
  for (const s of schedule) lines.push(`${clock(s.hour)}: ${s.meds.map((m) => `${m.name}, ${doseText(m)}`).join('; ')}.`);
  for (const m of notDaily(plan.meds)) lines.push(`${everyLabel(m.freq.everyDays)}: ${m.name}, ${doseText(m)}.`.replace(/^./, (c) => c.toUpperCase()));
  for (const m of plan.meds.filter((m) => m.prn)) lines.push(`Only if you need it: ${m.name}, ${doseText(m)}${m.reason ? ` for ${m.reason}` : ''}.`);
  for (const m of plan.meds.filter((m) => !m.freq && !m.prn && !['stop', 'hold', 'ask'].includes(m.status))) lines.push(`No time written: ${m.name}${doseText(m) ? `, ${doseText(m)}` : ''}.`);
  for (const m of plan.meds.filter((m) => m.status === 'hold')) lines.push(`On hold for now: ${m.name}.`);
  for (const m of plan.meds.filter((m) => m.status === 'ask')) lines.push(`Ask your doctor before taking: ${m.name}.`);
  for (const m of plan.meds.filter((m) => m.status === 'stop')) lines.push(`Stop taking ${m.name}.`);
  for (const w of plan.er) lines.push(`Call 911: ${w.text}.`);
  for (const w of plan.call) lines.push(`Call your doctor: ${w.text}.`);
  for (const f of plan.followups) lines.push(`${f.who}.`);
  for (const r of plan.rules) lines.push(r.text);
  return lines.join('\n');
}
