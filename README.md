# Take Home

Paste hospital discharge instructions. Take Home turns them into a plan you can follow at home: a daily medicine schedule, the warning signs that mean "call 911" or "call your doctor", appointments with real dates, what not to do and until when, and the questions to bring your pharmacist. Every item points back to the line on your papers it came from.

**Live: https://adrian-erlikhman.github.io/take-home/** · [heart failure sample](https://adrian-erlikhman.github.io/take-home/?demo=heart) · [after-surgery sample](https://adrian-erlikhman.github.io/take-home/?demo=surgery)

Everything runs in the browser. There is no server and no account.

## Why

About 36% of U.S. adults have basic or below-basic health literacy (2003 National Assessment of Adult Literacy). Discharge papers arrive at the most tiring moment of a hospital stay, full of abbreviations like PO, BID and QHS, with medicines marked new, changed or stopped in a single list. Take Home doesn't add medical advice. It rearranges what the care team wrote so it's easier to follow, and asks questions where the papers leave a gap.

## What it does

- **Your day.** Each medicine on a schedule built around when you wake up and go to bed, with new and changed doses marked, "only if you need it" medicines kept separate with their limits, and stopped medicines listed on their own.
- **Warning signs**, split into "call 911" and "call your doctor".
- **Appointments** with dates counted from the discharge date ("in 7 days" becomes Tue, Nov 17).
- **For now.** Restrictions with end dates ("no lifting more than 10 pounds for 4 weeks" becomes "until Mon, Dec 7").
- **Ask your pharmacist.** Two medicines that both contain acetaminophen (the FDA's adult limit is 4,000 mg a day from all medicines combined), two NSAIDs, "as needed" with no daily limit, no time of day, "as directed", or a medicine listed as both stop and take.
- **Words on your papers**, in plain language.
- **Print for the fridge** (one page) and **Add to my calendar** (.ics with medicine reminders and appointments).
- **Your papers, line by line.** Every item links back to its line.

## Where AI fits (optional, your own Anthropic key)

- **Photo of printed papers.** Claude types up the page. The text goes into the box for you to check against your paper before anything else happens.
- **Unusual layouts.** Claude sorts lines into sections. Every line it returns has to appear in your letter word for word, numbers included, or it's dropped. The page's own rules then read the sorted lines.
- **Ask about your papers.** Claude answers only from your papers and must quote the line it used. If the quote isn't in your papers word for word, or the answer has a number the quoted line doesn't, the answer isn't shown.
- **Translate the plan.** If the translation changes, adds or drops any number, it's thrown out.

Claude never decides a dose or a time.

## Run it

No build step.

```
npx http-server . -p 4173 -c-1
npm test
```

## Layout

```
js/parse.js     sections, medicines, frequencies, follow-ups, warnings, restrictions
js/plan.js      daily times, pharmacist questions, reading level, calendar file
js/glossary.js  plain-language terms and abbreviations
js/ai.js        optional Claude features, each with a check on what comes back
js/samples.js   two made-up discharge letters
js/app.js       interface
vendor/pdfjs    Mozilla pdf.js (Apache 2.0), for loading PDFs
fonts/          Inter and Source Serif 4 (SIL Open Font License)
test/test.mjs   15 tests
```

## Limits

- It reads the common layouts of U.S. discharge instructions in English. Papers without headings may need Claude's help or some editing.
- Times are a suggestion built from "twice a day" and similar wording. If your care team gave you exact times, use theirs.
- It is not medical advice and doesn't replace your care team or pharmacist. In an emergency, call 911.

## Credits

Built by Adrian Erlikhman and Michael Tarekegn in November 2026, with Claude Code as a coding assistant. The sample patients, hospitals and phone numbers are made up. MIT licensed.
