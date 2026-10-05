// Single source of truth for every real, indexable URL on the site.
// Both prerender.mjs and generate-sitemap.mjs import this file, so the
// prerendered pages and the sitemap can never drift out of sync with
// each other. If a new page is ever added to the app, add its path
// here and it will automatically be prerendered and appear in the
// sitemap on the next build.
//
// IMPORTANT: these paths must exactly match VIEW_PATH / GAME_SLUG /
// EXERCISE_SLUG inside src/App.jsx. If you ever rename a route in
// App.jsx, update it here too.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArticle, sortArticles } from "./src/articleFormat.js";

export const SITE_URL = "https://benjaminmithra.com";

// Every Markdown file in content/articles becomes /articles/<slug>, so a
// new article only needs its file: it is prerendered and added to the
// sitemap (with its own date as lastmod) on the next build.
const ARTICLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "content", "articles");
const ARTICLES = fs.existsSync(ARTICLES_DIR)
  ? sortArticles(
      fs.readdirSync(ARTICLES_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => parseArticle(fs.readFileSync(path.join(ARTICLES_DIR, f), "utf8"), f))
    )
  : [];

export const ROUTES = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  // Journals is hidden from the menus for now: still prerendered, so the
  // URL keeps working, but left out of the sitemap.
  { path: "/journals", changefreq: "weekly", priority: "0.6", sitemap: false },
  { path: "/exercises", changefreq: "monthly", priority: "0.8" },
  { path: "/exercises/breathing", changefreq: "monthly", priority: "0.6" },
  { path: "/exercises/leetspeak-reading", changefreq: "monthly", priority: "0.6" },
  { path: "/exercises/flow-type", changefreq: "monthly", priority: "0.6" },
  { path: "/exercises/guilfords-test", changefreq: "monthly", priority: "0.6" },
  { path: "/games", changefreq: "monthly", priority: "0.8" },
  { path: "/games/chess", changefreq: "monthly", priority: "0.6" },
  { path: "/games/recall", changefreq: "monthly", priority: "0.6" },
  { path: "/games/n-back", changefreq: "monthly", priority: "0.6" },
  { path: "/games/card-memory", changefreq: "monthly", priority: "0.6" },
  { path: "/games/word-memory", changefreq: "monthly", priority: "0.6" },
  { path: "/games/number-memory", changefreq: "monthly", priority: "0.6" },
  { path: "/rv-lab", changefreq: "monthly", priority: "0.8" },
  { path: "/consultation", changefreq: "monthly", priority: "1.0" },
  { path: "/faq", changefreq: "monthly", priority: "0.7" },
  { path: "/articles", changefreq: "weekly", priority: "0.7", lastmod: ARTICLES[0]?.date },
  ...ARTICLES.map((a) => ({ path: `/articles/${a.slug}`, changefreq: "monthly", priority: "0.6", lastmod: a.date })),
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
  { path: "/disclaimer", changefreq: "yearly", priority: "0.3" },
];
