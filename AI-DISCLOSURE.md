# AI disclosure

## AI used to build Take Home

- **Claude Code** (Anthropic) wrote most of the code: the parser, schedule builder, safety checks, interface, tests, and the scripts that render the demo video. We (Adrian Erlikhman and Michael Tarekegn) chose the problem, decided what the tool should and shouldn't do, set the safety rules (it never changes a dose, and every AI answer has to be checked against the papers), and reviewed and tested the results.
- The sample discharge letters are made up. They were written for this project and checked against common discharge-instruction formats.
- The facts quoted on the site and in the description were looked up and cited: the 4,000 mg acetaminophen limit (U.S. FDA) and the 36% health-literacy figure (2003 National Assessment of Adult Literacy).

## AI inside Take Home

The core of Take Home doesn't use AI. It reads discharge papers with written rules, so the same papers always give the same plan.

AI is optional and needs the user's own Anthropic API key. Every feature has a check on what comes back:

| Feature | What Claude does | The check |
|---|---|---|
| Photo of printed papers | Types up the page | The text goes into the box for the person to compare with their paper before anything else happens |
| Unusual layouts | Sorts lines into sections | Every line must appear in the letter word for word, numbers included, or it's dropped |
| Ask about your papers | Answers a question | Must quote the line it used. If the quote isn't in the papers word for word, or the answer has a number the quote doesn't, the answer is hidden |
| Translate the plan | Translates | Rejected if any number is changed, added or dropped |

Claude never decides a dose or a time. The checks are in `js/ai.js` and tested in `test/test.mjs`.
