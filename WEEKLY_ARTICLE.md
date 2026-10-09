# Article instructions

You are drafting one new article for benjaminmithra.com, the site of
Benjamin Mithra, a Mind Interpreter. Articles are drafted every Monday,
Wednesday and Friday. Follow every step below in order, without asking
questions; whoever started you may not be watching. If a step fails and
you cannot fix it, stop and say exactly what failed.

The article becomes a pull request that Benjamin reviews. **Never merge
it, never enable auto-merge, and never push to `main`.** The pull request
changes exactly three files: the new article, `content/topic-map.md` and
`content/advice-ledger.md`. Nothing else.

Quality matters more than keeping the schedule. If no topic meets these
standards today, don't write an article (see step 11).

---

## 1. Start from the latest `main`

1. Make sure the working tree has no uncommitted changes (`git status`).
   An untracked `package-lock.json` left by an earlier build is fine;
   anything else means someone is working here, so stop and don't
   discard it.
2. `git checkout main` and `git pull origin main`.
3. Today's date in India (IST, UTC+5:30) is the article date. Write it
   as `YYYY-MM-DD`.
4. Create the branch: `git checkout -b claude/article-YYYY-MM-DD`. If that
   branch already exists locally or on `origin`, an article was already
   started today: stop and say so.

## 2. Learn everything that has already been written

Read all of this before you research anything:

1. `content/topic-map.md`: every article's main keyword, secondary
   keywords, topic group, format and date.
2. `content/advice-ledger.md`: every suggestion, technique, script and
   solution already given.
3. Every article in `content/articles/`, in full.
4. Every open pull request whose branch starts with `claude/article-` or
   `article/`. Read the article it adds and its changes to the topic map
   and advice ledger (for example, `git fetch origin <branch>` and
   `git diff main...origin/<branch>`). These articles aren't on `main`
   yet, but they count exactly as if they were. If you can't list open
   pull requests, stop and say so, because you might repeat one.

Then note:

- the **previous article**: the most recent one by date, on `main` or in
  an open pull request. Write down its topic group and format.
- every main keyword, topic and suggestion that is already taken.

## 3. Keyword research (do this properly, every time)

1. **Find real questions.** Look at search suggestions (autocomplete),
   "People also ask" questions, related searches, and public discussions
   where people describe the problem in their own words (forums, Q&A
   sites, comment threads). Only read. Never post, reply, sign up, or
   contact anyone. Also notice anything seasonal for the coming weeks.
2. **Pick a topic group that is different from the previous article's.**
   The groups are: loneliness, difficult conversations, decisions,
   overthinking, life changes, relationships, work stress, family, and
   self-understanding. Over time, favor the groups the topic map shows
   least often.
3. **Choose one main keyword**: a specific, long phrase with clear intent
   that a new, small site can realistically rank for (for example, "what
   to say when your adult child stops calling", not "family problems").
   - Avoid broad single words and phrases dominated by huge sites.
   - Never choose a crisis search: nothing about suicide, self-harm,
     wanting to die, abuse that is happening now, or any emergency.
   - It must not match, or mean the same as, any main keyword or topic
     in the topic map or an open pull request.
   - It must fit in a title under 60 characters, near the start.
4. **Choose 3 to 5 secondary keywords and sub-questions** that the same
   reader also has (for example, "why do they go quiet when I bring it
   up", "is it normal to feel…").
5. **Study the top-ranking pages** for the main keyword (at least the top
   five). Note what they all say, and find what they miss: a fresh
   angle, a practical script, a clearer explanation, a situation they
   ignore. Your article must add something they don't. If you can't
   find a real gap, choose another keyword.
6. **Match search intent.** If people want steps, give steps. If they
   want words to use, give scripts. If they want reassurance or to
   understand themselves, give that.
7. **Keep your evidence** for the pull request: the searches, suggestions
   and questions you found (with links where possible), the top pages
   you studied, and the gap you will fill.

## 4. Plan before you write

1. **Choose a format different from the previous article's**: a
   step-by-step guide, "what to say" scripts, a reflective piece, or
   common questions (each sub-question answered in its own section).
2. **List the ideas** you plan to offer. Check each one against the
   advice ledger, and replace any that repeats an earlier suggestion,
   technique, script or solution, even in different words. Check for
   repeated *techniques*, not just repeated wording: "set a specific time
   to worry" and "schedule a slot for thinking about it" are the same
   technique however they're phrased. Every article must offer
   genuinely new ideas. The only exceptions are the
   safety sentences and the consultation link (see the note at the top
   of the ledger).
3. **Outline the subheadings** so they answer the secondary keywords and
   sub-questions.

## 5. Write the article

**Voice: a person, not a machine.** Write like a warm, thoughtful person
talking to one reader, as Benjamin, a Mind Interpreter. Use "you" and
"I". Benjamin's own beliefs and way of seeing things are welcome ("I
think…", "I've come to believe…"). Invented stories and client examples
are not.

- **Open with a specific, recognizable moment** the reader has lived
  through ("You're halfway through typing the message, and you delete it
  again."), not a general statement about life.
- **Use concrete, everyday details** (the kitchen at 11 p.m., the
  unanswered text, the drive home) instead of abstract advice.
- **Don't reuse signature phrases or closing images.** Check the previous
  article (and the one before it): don't repeat its signature phrases
  (for example, "I've come to believe") or its closing image (for
  example, a doorway or a light left on) in consecutive articles.
- **Vary sentence length.** Some short sentences. Plain words.
- **Write mostly in flowing paragraphs.** Use a list only where it truly
  helps, such as a few scripts to choose from. Never more than two lists
  in an article.
- **No generic advice** that anyone could have written ("communicate
  openly", "practice self-care", "be kind to yourself"). Every section
  must contain something specific and useful.
- **End with something human and memorable**, a thought or image the
  reader takes away, not a summary of the article.
- **Never use stock AI phrases**, including: "in today's fast-paced
  world", "it's important to note", "it's worth noting", "navigate",
  "delve", "journey", "unlock", "embrace", "game-changer", "in
  conclusion", "at the end of the day", "let's dive in", "whether you're
  … or …", "tapestry", "testament to", "realm", "resonate", "foster",
  "elevate", "holistic", or filler like "Great question".

**American English.** Use American spelling (color, toward, realize,
practice), American words and phrases (roommate, apartment, movie,
vacation, "on weekends"), and American punctuation (commas and periods
go inside closing quotation marks).

**No client stories.** Never claim specific client experiences or
results: no "in my conversations with people…", "my clients often…",
"someone I spoke with…", or "people I've helped…", and no promises of
what a conversation will achieve.
Also avoid phrases like "in my experience" or "I've found that"
that imply client experience; use "I think" or "I've come to believe"
instead.

**Facts.** Don't invent statistics, studies, quotes or experts. If you
mention research, keep it general and true ("many people find…"), or
leave it out.

**Length.** 1,000 to 1,200 words of article text (not counting the front
matter): complete, and readable in about 5 minutes.

## 6. Safety rules (always)

- Never give medical, psychological or therapy advice. Don't recommend
  medication, supplements or treatments, and don't tell anyone to stop
  one.
- Never claim to diagnose or treat anything. Don't describe Benjamin's
  conversations as therapy or counseling; they are conversations, a
  space to be heard and to think clearly.
- If the article is about overthinking, rumination or sleep, include this
  sentence on its own line, in a calm place near the end: "If this has
  been constant and affecting your sleep or daily life for weeks, it's
  worth talking to a doctor or mental health professional." (Wording may
  be adapted slightly to fit the article.)
- Don't label the reader with a condition ("you may have anxiety
  disorder" and the like).
- Never target crisis searches (see step 3.3).
- If the article touches loneliness or low mood in any way, include this
  sentence exactly, on its own line, in a calm place near the end:

  > If you're in crisis, please contact your local emergency services or a crisis line right away (for example, 988 in the US).

- If the article is about a relationship (a partner, spouse, dating,
  marriage, or a break-up), include this sentence exactly, on its own
  line, just before the crisis sentence (or near the end if there is no
  crisis sentence):

  > If you ever feel unsafe with your partner, please reach out for support. In the US, the National Domestic Violence Hotline is available at 1-800-799-7233.

## 7. SEO details and saving the file

- **Title:** under 60 characters, with the main keyword near the start.
- **Meta description:** 140 to 155 characters, containing the main
  keyword, written to make a person want to click.
- **Slug:** short, 3 to 6 lowercase words joined by hyphens, built from
  the main keyword (for example, `adult-child-stopped-calling`).
- **Main keyword** in the first 100 words, used naturally.
- **Subheadings** (`##`, 3 to 6 of them) that answer the sub-questions.
  Don't use a `#` heading; the title is shown automatically.
- **Internal links:** 1 or 2 links to genuinely related articles, as
  `[link text](/articles/<slug>)` (only if a related one exists), and
  exactly one link to `[link text](/consultation)`, placed naturally.
  The page already ends with a line inviting the reader to talk, so
  don't add your own sign-off.

Save the article as `content/articles/<slug>.md`, starting with this
front matter, then a blank line, then the article in Markdown:

```markdown
---
title: "Title under 60 characters, main keyword near the start"
date: YYYY-MM-DD
summary: "One sentence for the article list, under 160 characters."
description: "The meta description, 140 to 155 characters, containing the main keyword."
---

The opening moment…
```

Put the title, summary and description in double quotes. If one of them
needs a double quote, use single quotes inside instead. The date is
today's IST date from step 1.3.

## 8. Update the topic map and the advice ledger

1. Add one row at the end of the table in `content/topic-map.md`: date,
   linked title, main keyword, secondary keywords (separated by
   semicolons), topic group and format.
2. Add a section at the end of `content/advice-ledger.md`, headed
   `## YYYY-MM-DD · <slug>`, with one short line for every specific
   suggestion, technique, script or solution the article gives.
3. Don't change or remove anything already in either file.

## 9. Final quality check

1. **Re-read the article as the reader**, start to finish. Rewrite any
   paragraph that sounds generic, repeats an earlier article, or could
   have been written by anyone.
2. Then check every item below, and keep the results for the pull
   request:
   - [ ] Word count is 1,000 to 1,200 (for example,
     `awk 'BEGIN{n=0} /^---$/{n++; next} n>=2' content/articles/<slug>.md | wc -w`).
   - [ ] Title under 60 characters, main keyword near the start.
   - [ ] Meta description is 140 to 155 characters.
   - [ ] Main keyword in the first 100 words.
   - [ ] Subheadings answer the secondary questions.
   - [ ] 1 or 2 related article links (if any exist), and exactly one
     link to /consultation.
   - [ ] Topic group and format both differ from the previous article's.
   - [ ] Main keyword and topic aren't already covered (topic map, all
     articles, open pull requests).
   - [ ] No idea repeats anything in the advice ledger.
   - [ ] Opens with a specific moment and ends with something human,
     not a summary.
   - [ ] Mostly paragraphs, at most two lists, and no stock AI phrases.
   - [ ] American English throughout.
   - [ ] No client stories or claimed results, and no invented facts.
   - [ ] Safety rules met: no medical or therapy advice, the crisis
     sentence if it touches loneliness or low mood, and the hotline
     sentence if it's about a relationship.
   - [ ] Topic map and advice ledger updated.
3. Run `npm install` and then `npm run build`. The build must succeed,
   and `dist/articles/<slug>/index.html` must exist and contain the
   title. If the build fails because of the article, fix the article.
4. `git status` must show exactly three changed files: the new article,
   `content/topic-map.md` and `content/advice-ledger.md`. Don't commit
   anything else (not `package-lock.json`, `dist/`, or other changes).

## 10. Commit, push and open the pull request

1. `git add content/articles/<slug>.md content/topic-map.md content/advice-ledger.md`
2. `git commit -m "New article: <title>"`
3. `git push -u origin claude/article-YYYY-MM-DD`
4. Open a pull request into `main`, titled exactly
   `New article: <title>`. In the body, write:
   - **Main keyword**, and the **secondary keywords**.
   - **Evidence**: where you found people asking (suggestions, "People
     also ask", related searches, discussions), with links where
     possible.
   - **Competition and gap**: the top pages you studied, what they all
     say, and what this article adds that they don't.
   - **Topic group and format**, and those of the previous article.
   - **Word count.**
   - **Quality check**: the full checklist from step 9 with each result.
   - **Safety**: which safety sentences are included and why.
   - "Merge this pull request to publish the article."

   With the GitHub CLI: `gh pr create --base main --head claude/article-YYYY-MM-DD --title "New article: <title>" --body "<body>"`.
   In a cloud session without it, use the GitHub tools you have.
5. **Do not merge it.** Benjamin reviews and merges it. Finish by
   printing the pull request link.

## 11. If no topic meets these standards

If you can't find a main keyword that is specific, realistically
rankable, not already covered, in a different topic group from the
previous article, and with a real gap to fill, or you can't write
genuinely new advice for it, then don't write an article. Don't push
anything and don't open a pull request. Switch back to `main`, delete
your local branch, and finish by reporting what you looked at and why
none of it was good enough.
