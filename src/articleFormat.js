// Reads one article file from content/articles. Shared by the app (which
// loads the files through Vite) and by routes.config.mjs (which reads them
// from disk for prerendering and the sitemap), so both always agree on an
// article's slug, title and date.
//
// An article is a Markdown file named <slug>.md that starts with:
//
//   ---
//   title: How do I stop overthinking at night?
//   date: 2026-10-05
//   summary: One line shown on the /articles list.
//   description: The meta description for search results.
//   ---
//
// followed by the article itself in Markdown.

const REQUIRED = ["title", "date", "summary", "description"];

export function slugFromFilename(filename) {
  return filename.split("/").pop().replace(/\.md$/i, "");
}

export function parseArticle(raw, filename) {
  const slug = slugFromFilename(filename);
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`Article "${filename}" is missing its --- front matter block.`);

  const meta = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[m[1]] = value;
  }
  for (const key of REQUIRED) {
    if (!meta[key]) throw new Error(`Article "${filename}" is missing "${key}" in its front matter.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    throw new Error(`Article "${filename}" has date "${meta.date}"; use YYYY-MM-DD.`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Article file "${filename}" should be named in lowercase words joined by hyphens.`);
  }

  const body = match[2].trim();
  const words = body.replace(/[#>*_`\[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: meta.title,
    date: meta.date,
    summary: meta.summary,
    description: meta.description,
    body,
    words,
    readingMinutes: Math.max(1, Math.round(words / 200)),
  };
}

// Newest first; same-day articles fall back to title order.
export function sortArticles(articles) {
  return [...articles].sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : b.date.localeCompare(a.date)));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "2026-10-05" -> "5 October 2026", the same in every browser and time zone.
export function formatArticleDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
