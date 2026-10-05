# Weekly article: instructions

You are writing one new article for benjaminmithra.com, the site of
Benjamin Mithra, a Mind Interpreter. Follow every step below in order,
without asking questions; whoever started you may not be watching. If a
step fails and you cannot fix it, stop and say exactly what failed.

The article becomes a pull request that Benjamin reviews. **Never merge
it, never push to `main`, and never change anything except the one new
article file.**

---

## 1. Start from the latest `main`

1. Make sure the working tree has no uncommitted changes (`git status`).
   An untracked `package-lock.json` left by an earlier build is fine;
   anything else means someone is working here, so stop and don't
   discard it.
2. `git checkout main` and `git pull origin main`.
3. Today's date in India (IST, UTC+5:30) is the article date. Write it
   as `YYYY-MM-DD`.
4. Create the branch: `git checkout -b article/YYYY-MM-DD`. If that
   branch already exists locally or on `origin`, an article was already
   started today: stop and say so.

## 2. Research a question people are asking

1. Read the front matter (`title` and `summary`) of every file in
   `content/articles/` so you know what is already covered.
2. Search the web for what people are asking right now about these
   themes:
   - loneliness and feeling alone
   - difficult conversations (with a partner, family, a friend, a boss)
   - hard decisions and feeling stuck
   - overthinking and a mind that won't switch off
   - feeling unheard, misunderstood, or like a burden
   - life changes (moving, a break-up, a new job, children leaving,
     retirement, becoming a parent)

   Look at search suggestions (autocomplete), "People also ask" style
   questions, forum and Q&A titles, and anything seasonal for the coming
   weeks (holidays, new year, exam season, the anniversary of a loss,
   long winter evenings).
3. Choose **one** long, specific question that real people type, for
   example "how to tell my family I feel lonely even though I live with
   them", rather than a broad one like "loneliness".
4. It must not already be covered by an article in `content/articles/`
   (the same question in other words counts as covered).
5. Never choose a crisis search: nothing about suicide, self-harm, wanting
   to die, abuse that is happening now, or any emergency. Pick a
   different question.
6. Note the exact search phrase you chose. You will use it word for word.

## 3. Write the article

**Voice.** Write in English only, as Benjamin: a Mind Interpreter who
listens to people for a living. Be warm, plain and calm; write the way
a kind person speaks. Use short paragraphs, "you" and "I", and everyday
words. Don't hype, use jargon, or lecture.

**Length.** 900 to 1,300 words of article text, not counting the front
matter.

**Helpful.** Give the reader something they can actually do or think
about today: questions to ask themselves, ways to start a hard sentence,
small next steps, what to notice. Use real-life examples. Every section
should earn its place.

**SEO.**
- Use the exact search phrase in the title, in the first paragraph, and
  in one `##` subheading.
- Use 3 to 6 `##` subheadings. Don't use a `#` heading; the title is
  shown automatically.
- If other articles exist in `content/articles/`, link to one or two
  that are genuinely related, as `[link text](/articles/<slug>)`.
- Link to the consultation page once in the body, naturally, as
  `[link text](/consultation)`. (The page already ends with a line
  inviting the reader to talk, so don't add your own closing sign-off.)

**Facts.** Don't invent statistics, studies, quotes or experts. If you
mention research, keep it general and true ("many people find…"), or
leave it out.

## 4. Safety rules (always)

- Never give medical, psychological or therapy advice. Don't recommend
  medication, supplements or treatments, and don't tell anyone to stop
  one.
- Never claim to diagnose or treat anything. Don't describe Benjamin's
  conversations as therapy or counselling; they are conversations, a
  space to be heard and to think clearly.
- Don't label the reader with a condition ("you may have anxiety
  disorder" and the like).
- Never target crisis searches (see step 2.5).
- If the article touches loneliness or low mood in any way, include this
  sentence exactly, on its own line, in a calm place near the end:

  > If you're in crisis, please contact your local emergency services or a crisis line right away (for example, 988 in the US).

## 5. Save the file

Save the article as `content/articles/<slug>.md`, where `<slug>` is the
title in lowercase words joined by hyphens: no punctuation, at most
about 8 words. For example, `how-to-stop-overthinking-at-night.md`.

The file must start with this front matter, then a blank line, then the
article in Markdown:

```markdown
---
title: "The exact title, containing the search phrase"
date: YYYY-MM-DD
summary: "One sentence for the article list, under 160 characters."
description: "The meta description for search results, 140 to 160 characters, containing the search phrase."
---

First paragraph, containing the search phrase…
```

- Put the title, summary and description in double quotes. If one of
  them needs a double quote, use single quotes inside instead.
- The date is today's IST date from step 1.3.

## 6. Check before you commit

1. Count the words of the article body: it must be 900 to 1,300.
2. Confirm the exact search phrase appears in the title, the first
   paragraph and one `##` subheading.
3. Confirm the safety rules, including the crisis sentence if the topic
   touches loneliness or low mood.
4. Run `npm install` and then `npm run build`. The build must succeed,
   and `dist/articles/<slug>/index.html` must exist and contain the
   title. If the build fails because of the article, fix the article.
5. `git status` must show exactly one new file: your article. Don't
   commit anything else (not `package-lock.json`, `dist/`, or other
   changes).

## 7. Commit, push and open the pull request

1. `git add content/articles/<slug>.md`
2. `git commit -m "New article: <title>"`
3. `git push -u origin article/YYYY-MM-DD`
4. Open a pull request into `main`, titled exactly
   `New article: <title>`. In the body, write:
   - the search phrase you targeted and where you found people asking
     it;
   - the word count;
   - which safety rules applied (for example, whether the crisis line is
     included);
   - "Merge this pull request to publish the article."

   With the GitHub CLI: `gh pr create --base main --head article/YYYY-MM-DD --title "New article: <title>" --body "<body>"`.
5. **Do not merge it.** Benjamin reviews and merges it. Finish by
   printing the pull request link.
