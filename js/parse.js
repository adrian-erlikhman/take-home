// Reads discharge instructions with rules, not a model. Every item keeps the
// line it came from, so the plan can always point back to the paper.

const HEADINGS = [
  ['er', /\b911\b|EMERGENCY/i],
  ['call', /\b(CALL|CONTACT|NOTIFY)\b.*\b(DOCTOR|SURGEON|PROVIDER|NURSE|CLINIC|CARE TEAM|OFFICE)\b|WHEN TO CALL/i],
  ['meds', /MEDICATION|MEDICINE|PRESCRIPTION/i],
  ['followup', /FOLLOW|APPOINTMENT/i],
  ['diet', /\bDIET\b|EATING|FLUIDS?\b/i],
  ['activity', /ACTIVITY|EXERCISE|DRIVING|LIFTING|BATHING/i],
  ['wound', /WOUND|INCISION|DRESSING/i],
  ['weights', /WEIGHT/i],
];
// After-visit summaries group medicines: "STOP taking these medications",
// "CHANGE how you take these medications", "New medications".
const GROUP = /^(start|stop|change|continue|ask|resume|hold)\b[^.:\d]*\b(medications?|medicines?)\s*:?$/i;
const GROUP_STATUS = { start: 'start', new: 'start', stop: 'stop', stopped: 'stop', discontinue: 'stop', discontinued: 'stop', change: 'changed', changed: 'changed', continue: 'continue', ask: 'ask', resume: 'resume', hold: 'hold' };

export function isHeading(line) {
  const t = line.trim();
  if (!t || t.length > 70 || /^[-•*]/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  if (GROUP.test(t)) return true;
  const known = HEADINGS.some(([, re]) => re.test(t));
  // A medicine line in capitals ("NEW: LASIX 40 MG DAILY") is not a heading.
  if (STRENGTH.test(t) || STATUS.test(t) || (!known && /\d/.test(t))) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upper > 0.85) return true;
  if (!known) return false;
  if (/:$/.test(t)) return true;
  // No colon: "Follow-up Information", "Wound Care", "Call your doctor if"
  const words = t.split(/\s+/);
  const title = words.length <= 5 && !/[.!?,;]$/.test(t) && !/\d/.test(t) && words.every((w) => w.length < 4 || /^[A-Z]/.test(w));
  return title || /\sif$/i.test(t);
}

export function headingKind(line) {
  if (GROUP.test(line.trim())) return 'meds';
  for (const [kind, re] of HEADINGS) if (re.test(line)) return kind;
  return 'other';
}

function groupStatus(title) {
  if (!/medications?|medicines?/i.test(title)) return '';
  const m = title.match(/\b(start|new|stop|stopped|discontinued?|changed?|continue|ask|resume|hold)\b/i);
  return m ? GROUP_STATUS[m[1].toLowerCase()] : '';
}

export function sectionsOf(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections = [{ kind: 'header', title: '', lines: [] }];
  lines.forEach((raw, n) => {
    const t = raw.trim();
    if (!t) return;
    if (isHeading(t) && (headingKind(t) !== 'other' || sections.length > 1)) {
      const kind = headingKind(t), title = t.replace(/:$/, '');
      sections.push({ kind, title, lines: [], status: kind === 'meds' ? groupStatus(title) : '' });
      return;
    }
    sections[sections.length - 1].lines.push({ text: t.replace(/^[-•*]\s*/, ''), n: n + 1 });
  });
  return sections;
}

// ---------- header ----------
export function headerInfo(text) {
  const get = (re) => (text.match(re) || [])[1]?.trim();
  // "Discharge date: 11/10/2026", "Date of discharge: Nov. 10, 2026", "Discharged: 2026-11-10"
  let discharged = null;
  for (const m of text.matchAll(/(?:discharge(?:d)?(?:\s+date)?|date\s+of\s+discharge)\s*:?\s*/gi)) {
    const d = dateIn(text.slice(m.index + m[0].length, m.index + m[0].length + 24));
    if (d && d.index === 0) { discharged = d.date; break; }
  }
  return {
    patient: get(/patient(?:\s*name)?\s*:\s*([A-Za-z.' -]+?)(?:\s{2,}|\t|$|\s+discharge)/im),
    discharged,
    reason: get(/(?:reason for (?:your )?(?:hospital )?stay|diagnosis|procedure)\s*:\s*(.+)/i),
  };
}

export function toDate(s) {
  const [m, d, y] = s.split('/').map(Number);
  return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d));
}

// The first date written in s: 11/17/2026, 11-17-26, 2026-11-17, Nov. 17, November 17, 2026.
// Without a year, the date falls on or after `near` (the discharge date).
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b|\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i;
export function dateIn(s, near = null) {
  const m = String(s).match(DATE);
  if (!m) return null;
  let [y, mo, d] = m[1] ? [+m[3], +m[1], +m[2]] : m[4] ? [+m[4], +m[5], +m[6]] : [m[9] ? +m[9] : null, MONTHS.indexOf(m[7].slice(0, 3).toLowerCase()) + 1, +m[8]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y == null) y = (near || new Date()).getUTCFullYear();
  if (y < 100) y += 2000;
  let date = new Date(Date.UTC(y, mo - 1, d));
  if (m[7] && !m[9] && near && date < near) date = new Date(Date.UTC(y + 1, mo - 1, d));
  return { date, index: m.index };
}

// ---------- medications ----------
// Amounts as papers write them: 2, 0.5, .5, 1,000, 1/2, 1 1/2, one, half.
const N = String.raw`(?:\d+\s+1\/2|\d+\/\d+|\d{1,3}(?:,\d{3})+(?!\d)|\d*\.\d+|\d+|(?:one-half|one half|a half|half|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen)(?![a-z]))`;
const WORDS = { 'one-half': 0.5, 'one half': 0.5, 'a half': 0.5, half: 0.5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14 };
export function num(s) {
  s = String(s).toLowerCase().trim();
  if (s in WORDS) return WORDS[s];
  const m = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (m) return (+m[1] || 0) + +m[2] / +m[3];
  return +s.replace(/,/g, '');
}

const STATUS = /^(NEW|CHANGED?|CONTINUE|STOP|START|RESUME|HOLD)\s*:\s*/i;
// 40 mg, 5-325 mg, .6 mg, 1,000 mg, and a concentration: 100 units/mL, 40 mg/0.4 mL, 90 mcg/actuation
const STRENGTH = /((?:\d{1,3}(?:,\d{3})+|\d*\.\d+|\d+)(?:\s*[-/]\s*(?:\d*\.\d+|\d+))?)\s*(mg|mcg|g|mEq|units?|mL|%)(?![a-z])(?:\s*\/\s*(\d*\.?\d+\s*)?(mL|actuation|spray|puff|dose|hr|hour)\b)?/i;
const FORMS = /\b(tablets?|capsules?|puffs?|drops?|patch(?:es)?|sprays?|teaspoons?|mL)\b/i;
const UNIT = /^(tablets?|tabs?|capsules?|caps?|puffs?|drops?|patch(?:es)?|sprays?|teaspoons?|tablespoons?|units?|doses?|packets?|suppositor(?:y|ies)|lozenges?|mL|mg|mcg|g|mEq)$/i;
const VERB = String.raw`(?:take|use|inhale|inject|apply|chew|dissolve|place|insert|instill|give|spray)`;
const MEASURE = { ml: 'mL', mg: 'mg', mcg: 'mcg', g: 'g', meq: 'mEq' };

export function parseMed(line, groupStatus = '') {
  const text = line.text ?? line;
  let rest = text.trim();
  const st = rest.match(STATUS);
  const status = st ? ({ CHANGE: 'changed' }[st[1].toUpperCase()] || st[1].toLowerCase()) : groupStatus || 'take';
  if (st) rest = rest.slice(st[0].length);

  const sm = rest.match(STRENGTH);
  const head = sm ? rest.slice(0, sm.index) : rest.split(/\s[-–]\s|\.\s/)[0];
  const brand = (head.match(/\(([^)]+)\)/) || [])[1] || '';
  let name = (sm ? head : rest.split(/\s[-–]\s|[.(]/)[0]).replace(/\([^)]*\)/g, '').replace(/\s[-–]\s.*$/, '').trim();
  name = name.replace(/\s+(tablet|capsule)s?$/i, '').trim();
  // ".6 mg" is shown as "0.6 mg": the same number, harder to misread as 6
  const zero = (s) => s.replace(/(^|[^\d])\.(\d)/g, '$10.$2');
  const strength = sm ? `${zero(sm[1].replace(/\s+/g, ''))} ${MEASURE[sm[2].toLowerCase()] || sm[2].toLowerCase()}${sm[4] ? `/${sm[3] ? `${zero(sm[3].trim())} ` : ''}${MEASURE[sm[4].toLowerCase()] || sm[4]}` : ''}` : '';

  const how = sm ? rest.slice(sm.index + sm[0].length) : rest.slice(name.length);
  const count = how.match(new RegExp(String.raw`\b${VERB}\s+(${N})(?:\s*(?:to|-|or)\s*(${N}))?\s*(?:an?\s+)?([a-z]+)?`, 'i'));
  const said = count?.[3] || '';
  const form = UNIT.test(said) ? said : (how.match(FORMS) || [])[1] || '';
  // "1 tablet in the morning and 2 at bedtime": one amount can't stand for every dose
  const amounts = new Set([...how.replace(/(?:no|not)\s+(?:take\s+)?more than[^.;]*/gi, '')
    .matchAll(new RegExp(String.raw`(?<![\d/.,-])(${N})\s+(?:tablets?|tabs?|capsules?|puffs?|units?|drops?|sprays?)\b`, 'gi'))].map((m) => num(m[1])));
  const prn = /\bas needed\b|\bPRN\b/i.test(how);
  const reason = (how.match(/as needed for ([^.;]+)/i) || [])[1] || '';
  const maxm = how.match(new RegExp(String.raw`(?:no|not)\s+(?:take\s+)?more than\s+(${N})\s+([a-z]+)\s+(?:in|per|a|each)\s+(24 hours|day)`, 'i'));
  const dur = how.match(new RegExp(String.raw`\bfor\s+(?:the next\s+|another\s+)?(${N})\s+(days?|weeks?)\b`, 'i'));
  const whileTaking = (how.match(/\bwhile (?:you are )?taking ([\w-]+)/i) || [])[1] || '';
  const mixed = amounts.size > 1;

  return {
    status, name, brand, strength,
    dose: count && !mixed ? { min: num(count[1]), max: num(count[2] || count[1]), unit: singular(form) } : null,
    route: /\bby mouth\b|\bPO\b/i.test(how) ? 'by mouth' : '',
    freq: frequency(how),
    prn, reason: reason.trim(),
    max: maxm ? { n: num(maxm[1]), unit: singular(maxm[2]), per: '24 hours' } : null,
    days: dur ? num(dur[1]) * (/week/i.test(dur[2]) ? 7 : 1) : null,
    whileTaking,
    withFood: /with (food|meals?)/i.test(how),
    note: (how.match(/(dose (?:increased|decreased|changed)[^.]*\.?|finish all[^.]*\.?)/i) || [])[1] || (mixed ? 'Different amounts at different times: check your papers.' : ''),
    source: text, line: line.n ?? null,
  };
}

function singular(w) {
  const l = (w || '').toLowerCase();
  if (MEASURE[l]) return MEASURE[l];
  return /patches$/.test(l) ? 'patch' : /ies$/.test(l) ? l.replace(/ies$/, 'y') : l.replace(/s$/, '');
}

const COUNT = { once: 1, one: 1, twice: 2, two: 2, three: 3, four: 4 };
const BEDTIME = /\b(at bedtime|QHS|nightly|every night|at night)\b/i;
const EVENING = /\b(in the evening|every evening|QPM|with (?:dinner|supper))\b/i;
const MORNING = /\b(in the morning|every morning|QAM|(?:with|before) breakfast)\b/i;

export function frequency(s) {
  const every = s.match(/every\s+(\d+)\s*(?:(?:to|-|–)\s*\d+\s*)?(?:hours?|hrs?)\b|\bq\s?(\d+)(?:\s?-\s?\d+)?\s?(?:h|hrs?)\b/i);
  if (every) {
    const h = +(every[1] || every[2]);
    return h > 24 && h % 24 === 0 ? { perDay: 1, everyDays: h / 24 } : { every: h };
  }
  // "three times daily", "2 times a day", "twice a day", BID, TID, QID
  const n = s.match(/\b(?:(once|twice)|(one|two|three|four|[1-4])\s*(?:times?|x))\s*(?:a|per|each|every|\/)?\s*(?:day|daily)\b/i);
  const perDay = /\bQID\b/i.test(s) ? 4 : /\bTID\b/i.test(s) ? 3 : /\bBID\b/i.test(s) ? 2 : n ? COUNT[(n[1] || n[2]).toLowerCase()] || +n[2] : 0;
  // "in the morning and at bedtime" is twice a day, not once
  const both = s.match(/\b(?:morning|breakfast)\b[^.;]*\band\b[^.;]*\b(evening|bedtime|night|dinner|supper)\b/i);
  if (perDay > 1 || both) {
    const f = { perDay: perDay || 2 };
    if (f.perDay === 2 && both) f.when = /bedtime|night/i.test(both[1]) ? 'bedtime' : 'evening';
    return f;
  }
  const d = s.match(/\bevery other day\b|\bon alternate days\b|\bQOD\b|\bevery\s+(\d|two|three)\s+days\b|\b(once a week|once weekly|weekly|every week)\b/i);
  const everyDays = !d ? 0 : d[2] ? 7 : d[1] ? COUNT[d[1].toLowerCase()] || +d[1] : 2;
  const when = BEDTIME.test(s) ? 'bedtime' : EVENING.test(s) ? 'evening' : MORNING.test(s) ? 'morning' : '';
  if (!perDay && !when && !everyDays && !/\b(daily|every day|each day|QD)\b/i.test(s)) return null;
  const f = { perDay: 1 };
  if (when) f.when = when;
  if (everyDays > 1) f.everyDays = everyDays;
  return f;
}

// ---------- follow-ups, warnings, restrictions ----------
const PHONE = /(\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\b\d{3}-\d{4}\b)/;

export function addDays(date, n) { return date ? new Date(date.getTime() + n * 86400000) : null; }
const addMonths = (date, n) => (date ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, date.getUTCDate())) : null);

// "4 weeks", "two weeks", "1-2 weeks", "3 months": the later end of a range, as a date.
const SPAN = String.raw`(${N})(?:\s*(?:to|-|–|or)\s*(${N}))?\s+(hours?|days?|weeks?|months?)\b`;
function spanEnd(m, from, i = 1) {
  const n = num(m[i + 1] || m[i]), u = m[i + 2];
  if (/month/i.test(u)) return addMonths(from, n);
  return addDays(from, Math.ceil(n * (/week/i.test(u) ? 7 : /hour/i.test(u) ? 1 / 24 : 1)));
}
function spanText(m, i = 1) {
  const a = num(m[i]), b = m[i + 1] ? num(m[i + 1]) : null, u = m[i + 2].toLowerCase().replace(/s$/, '');
  if (b != null) return `${a} to ${b} ${u}s`;
  if (u === 'day' && a % 7 === 0) return `${a / 7} week${a > 7 ? 's' : ''}`;
  return `${a} ${u}${a === 1 ? '' : 's'}`;
}

export function parseFollowup(line, discharged) {
  const t = line.text;
  const w = t.match(new RegExp(String.raw`\b(in|within)\s+(?:the next\s+)?${SPAN}`, 'i'));
  const on = dateIn(t, discharged);
  const time = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i);
  const range = !!w?.[3];
  const by = !on && !!w && (/within/i.test(w[1]) || range);
  const date = on ? on.date : w ? spanEnd(w, discharged, 2) : null;
  // Who or what, without the when: "Cardiology clinic with Dr. Patel" from "... in 7 days. Call ..."
  const cuts = [w?.index, on?.index, time?.index, t.search(/\s(?:on|-|–)\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i)].filter((i) => i > 0);
  const who = (cuts.length ? t.slice(0, Math.min(...cuts)) : t).split(/(?<!\b(?:Dr|St|Mr|Mrs|Ms))\.\s/)[0]
    .replace(/\s+(?:on|at)\s*$/i, '').replace(/[\s,;:–-]+$/, '').replace(/\.$/, '').trim();
  return {
    who, by, date,
    days: w && !on && !/month/i.test(w[4]) ? Math.ceil(num(w[3] || w[2]) * (/week/i.test(w[4]) ? 7 : /hour/i.test(w[4]) ? 1 / 24 : 1)) : null,
    when: on ? (time ? `${+time[1]}:${time[2] || '00'} ${time[3].toUpperCase()}M` : '') : w ? `${/within/i.test(w[1]) ? 'Within' : 'In'} ${spanText(w, 2)}` : '',
    time: on && time ? { h: (+time[1] % 12) + (/p/i.test(time[3]) ? 12 : 0), m: +(time[2] || 0) } : null,
    phone: (t.match(PHONE) || [])[1] || '', toSchedule: /call\b.*\bto schedule|schedule/i.test(t),
    source: t, line: line.n,
  };
}

export function parseRule(line, kind, discharged) {
  const t = line.text;
  const dont = /^(no|do not|don't|avoid|never)\b/i.test(t) || /\b(less than|no more than|not more than|limit|should not|shouldn't|must not|may not|cannot|can't|do not|don't|avoid|never)\b/i.test(t);
  const d = t.match(new RegExp(String.raw`\bfor\s+(?:at least\s+|the next\s+|about\s+|another\s+)?${SPAN}`, 'i'));
  const after = t.match(new RegExp(String.raw`\b(?:in|after)\s+${SPAN}`, 'i'));
  return {
    kind, dont, text: t,
    until: d ? spanEnd(d, discharged) : null,
    from: after && !d && /\b(may|can)\b/i.test(t) ? spanEnd(after, discharged) : null,
    while: (t.match(/\bwhile (?:you are )?taking ([\w-]+)/i) || [])[1] || '',
    source: t, line: line.n,
  };
}

// ---------- the whole letter ----------
export function parseInstructions(text, { discharged = null } = {}) {
  const info = headerInfo(text);
  info.discharged ||= discharged; // the day the person entered, when the papers have none
  const sections = sectionsOf(text);
  const plan = { info, meds: [], followups: [], er: [], call: [], rules: [], callPhone: '', unread: [] };
  const instruction = new RegExp(String.raw`^${VERB}\b`, 'i');
  for (const s of sections) {
    let last = null; // the medicine above, in this section
    for (const line of s.lines) {
      if (s.kind === 'meds') {
        // A medicine written over several lines, as after-visit summaries do:
        //   furosemide 40 MG tablet / Commonly known as: LASIX / Take 1 tablet by mouth daily.
        const known = line.text.match(/^(?:commonly known as|brand name)\s*:\s*(.+)$/i);
        if (last && known) { last.brand ||= known[1].trim(); continue; }
        if (last && /^what changed\s*:/i.test(line.text)) { last.note ||= line.text; continue; }
        if (last && instruction.test(line.text) && !last.dose && !last.freq && !last.prn) {
          const { brand, note } = last;
          Object.assign(last, parseMed({ text: `${last.source} ${line.text}`, n: last.line }, s.status));
          last.brand ||= brand; last.note ||= note;
          continue;
        }
        const m = parseMed(line, s.status);
        if (m.name && !instruction.test(m.name)) plan.meds.push(last = m); else plan.unread.push(line);
      } else if (s.kind === 'followup') plan.followups.push(parseFollowup(line, info.discharged));
      else if (s.kind === 'er') plan.er.push({ text: line.text, line: line.n });
      else if (s.kind === 'call') plan.call.push({ text: line.text, line: line.n });
      else if (['diet', 'activity', 'wound', 'weights'].includes(s.kind)) {
        for (const sentence of line.text.split(/(?<=\.)\s+(?=[A-Z])/)) plan.rules.push(parseRule({ text: sentence, n: line.n }, s.kind, info.discharged));
      } else if (s.kind !== 'header') plan.unread.push(line);
    }
    if (s.kind === 'call') plan.callPhone = (s.title.match(PHONE) || [])[1] || plan.callPhone;
  }
  // No medicines heading at all: read lines like "Lisinopril 10 mg - take 1 tablet daily" anyway.
  if (!sections.some((s) => s.kind === 'meds')) {
    const take = new RegExp(String.raw`\b${VERB}\b`, 'i');
    for (const line of sections[0].lines) {
      if (!STRENGTH.test(line.text) || !(frequency(line.text) || take.test(line.text))) continue;
      const m = parseMed(line);
      if (m.name && !instruction.test(m.name)) plan.meds.push(m);
    }
  }
  return plan;
}
