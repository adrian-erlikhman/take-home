// Words and abbreviations that show up on discharge papers, in plain language.
// Abbreviations match only in capitals so "po" inside a word isn't caught.

export const TERMS = [
  ['PO', 'by mouth', true],
  ['QD', 'once a day', true],
  ['BID', 'twice a day', true],
  ['TID', 'three times a day', true],
  ['QID', 'four times a day', true],
  ['QHS', 'at bedtime', true],
  ['PRN', 'only when you need it', true],
  ['ER', 'after a medicine name, extended release: it\u2019s released slowly, so swallow it whole unless told otherwise. Elsewhere, emergency room', true],
  ['XL', 'extended release: the medicine is released slowly. Swallow it whole unless told otherwise', true],
  ['mEq', 'milliequivalent, a unit used for potassium and other salts', true],
  ['mg', 'milligram, a unit of weight for medicine', true],
  ['CHF', 'congestive heart failure: the heart doesn’t pump as well as it should, so fluid can build up', true],
  ['BMP', 'basic metabolic panel, a blood test for salts like potassium and for kidney function', true],
  ['NSAID', 'a kind of pain reliever, like ibuprofen (Advil, Motrin) or naproxen (Aleve)', true],
  ['APAP', 'acetaminophen (Tylenol)', true],
  ['exacerbation', 'a flare-up: a time when a condition gets worse'],
  ['congestive heart failure', 'the heart doesn’t pump as well as it should, so fluid can build up'],
  ['sodium', 'salt'],
  ['as tolerated', 'as much as you comfortably can'],
  ['laparoscopic', 'surgery done through a few small cuts, using a camera'],
  ['appendectomy', 'surgery to remove the appendix'],
  ['incision', 'the cut made during surgery'],
  ['Steri-Strips', 'thin tape strips that hold a small cut closed'],
  ['frothy', 'foamy'],
  ['lightheaded', 'feeling like you might faint'],
  ['potassium chloride', 'a potassium supplement'],
  ['furosemide', 'a “water pill” that helps your body get rid of extra fluid'],
  ['diuretic', 'a “water pill” that helps your body get rid of extra fluid'],
  ['docusate', 'a stool softener, often given with opioid pain medicine'],
  ['oxycodone', 'an opioid pain medicine'],
  ['cephalexin', 'an antibiotic'],
  ['antibiotic', 'a medicine that fights infections caused by bacteria'],
];

export function glossaryFor(text) {
  const found = [];
  for (const [term, plain, caps] of TERMS) {
    const re = new RegExp(`(?<![A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, caps ? '' : 'i');
    if (re.test(text) && !found.some((f) => f.plain === plain)) found.push({ term, plain });
  }
  return found;
}
