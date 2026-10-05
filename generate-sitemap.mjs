// Generates sitemap.xml from the same route list the prerenderer uses,
// so the two can never disagree about what pages exist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES, SITE_URL } from "./routes.config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const today = new Date().toISOString().split("T")[0];

const SITEMAP_ROUTES = ROUTES.filter((r) => r.sitemap !== false);

const urlEntries = SITEMAP_ROUTES.map(({ path: p, changefreq, priority, lastmod }) => `  <url>
    <loc>${SITE_URL}${p}</loc>
    <lastmod>${lastmod || today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>
`;

const distDir = path.join(__dirname, "dist");
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "sitemap.xml"), xml);
console.log(`Generated sitemap.xml with ${SITEMAP_ROUTES.length} routes.`);
