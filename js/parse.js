// Reads discharge instructions with rules, not a model. Every item keeps the
// line it came from, so the plan can always point back to the paper.

const HEADINGS = [
  ['er', /\b911\b|EMERGENCY/i],
  ['call', /\bCALL\b.*\b(DOCTOR|SURGEON|PROVIDER|NURSE|CLINIC|CARE TEAM|OFFICE)\b|WHEN TO CALL/i],
  ['meds', /MEDICATION|MEDICINE|PRESCRIPTION/i],
  ['followup', /FOLLOW|APPOINTMENT/i],
  ['diet', /\bDIET\b|EATING|FLUIDS?\b/i],
  ['activity', /ACTIVITY|EXERCISE|DRIVING|LIFTING|BATHING/i],
  ['wound', /WOUND|INCISION|DRESSING/i],
  ['weights', /WEIGHT/i],
];

export function isHeading(line) {
  const t = line.trim();
  if (!t || t.length > 70 || /^[-•*]/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
  return upper > 0.85 || (/:$/.test(t) && HEADINGS.some(([, re]) => re.test(t)));
}

export function headingKind(line) {
  for (const [kind, re] of HEADINGS) if (re.test(line)) return kind;
  return 'other';
}

export function sectionsOf(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections = [{ kind: 'header', title: '', lines: [] }];
  lines.forEach((raw, n) => {
    const t = raw.trim();
    if (!t) return;
    if (isHeading(t) && (headingKind(t) !== 'other' || sections.length > 1)) {
      sections.push({ kind: headingKind(t), title: t.replace(/:$/, ''), lines: [] });
      return;
    }
    sections[sections.length - 1].lines.push({ text: t.replace(/^[-•*]\s*/, ''), n: n + 1 });
  });
  return sections;
}

// ---------- header ----------
export function headerInfo(text) {
  const get = (re) => (text.match(re) || [])[1]?.trim();
  const date = get(/discharge(?:d)?\s*date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  return {
    patient: get(/patient(?:\s*name)?\s*:\s*([A-Za-z.' -]+?)(?:\s{2,}|\t|$|\s+discharge)/im),
    discharged: date ? toDate(date) : null,
    reason: get(/(?:reason for (?:your )?(?:hospital )?stay|diagnosis|procedure)\s*:\s*(.+)/i),
  };
}

export function toDate(s) {
  const [m, d, y] = s.split('/').map(Number);
  return new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d));
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

export function parseMed(line) {
  const text = line.text ?? line;
  let rest = text.trim();
  const st = rest.match(STATUS);
  const status = st ? ({ CHANGE: 'changed' }[st[1].toUpperCase()] || st[1].toLowerCase()) : 'take';
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

export function parseFollowup(line, discharged) {
  const t = line.text;
  const w = t.match(/\b(in|within)\s+(\d+)\s+(days?|weeks?|months?)\b/i);
  const n = w ? +w[2] * (/week/i.test(w[3]) ? 7 : /month/i.test(w[3]) ? 30 : 1) : null;
  const who = t.split(/\s+(?:in|within)\s+\d/)[0].split(/(?<!\b(?:Dr|St|Mr|Mrs|Ms))\.\s/)[0].replace(/\.$/, '').trim();
  return {
    who, by: w && /within/i.test(w[1]), days: n, date: n != null ? addDays(discharged, n) : null,
    phone: (t.match(PHONE) || [])[1] || '', toSchedule: /call\b.*\bto schedule|schedule/i.test(t),
    source: t, line: line.n,
  };
}

export function parseRule(line, kind, discharged) {
  const t = line.text;
  const dont = /^(no|do not|don't|avoid|never)\b/i.test(t) || /\b(less than|no more than|not more than|limit)\b/i.test(t);
  const d = t.match(/\bfor\s+(\d+)\s+(days?|weeks?|hours?)\b/i);
  const after = t.match(/\bin\s+(\d+)\s+(hours?|days?)\b/i);
  const n = (m) => m && +m[1] * (/week/i.test(m[2]) ? 7 : /hour/i.test(m[2]) ? 1 / 24 : 1);
  return {
    kind, dont, text: t,
    until: d ? addDays(discharged, Math.ceil(n(d))) : null,
    from: after && !d && /may|can/i.test(t) ? addDays(discharged, Math.ceil(n(after))) : null,
    while: (t.match(/\bwhile (?:you are )?taking ([\w-]+)/i) || [])[1] || '',
    source: t, line: line.n,
  };
}

// ---------- the whole letter ----------
export function parseInstructions(text) {
  const info = headerInfo(text);
  const sections = sectionsOf(text);
  const plan = { info, meds: [], followups: [], er: [], call: [], rules: [], callPhone: '', unread: [] };
  for (const s of sections) {
    for (const line of s.lines) {
      if (s.kind === 'meds') {
        const m = parseMed(line);
        if (m.name) plan.meds.push(m); else plan.unread.push(line);
      } else if (s.kind === 'followup') plan.followups.push(parseFollowup(line, info.discharged));
      else if (s.kind === 'er') plan.er.push({ text: line.text, line: line.n });
      else if (s.kind === 'call') plan.call.push({ text: line.text, line: line.n });
      else if (['diet', 'activity', 'wound', 'weights'].includes(s.kind)) {
        for (const sentence of line.text.split(/(?<=\.)\s+(?=[A-Z])/)) plan.rules.push(parseRule({ text: sentence, n: line.n }, s.kind, info.discharged));
      } else if (s.kind !== 'header') plan.unread.push(line);
    }
    if (s.kind === 'call') plan.callPhone = (s.title.match(PHONE) || [])[1] || plan.callPhone;
  }
  return plan;
}
