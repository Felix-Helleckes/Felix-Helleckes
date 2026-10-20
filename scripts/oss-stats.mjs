// Rewrites the section between <!-- oss:start --> and <!-- oss:end --> in
// readme.md with Felix's contributions to repositories he does not own,
// taken from the GitHub search API.
//
// Usage: GITHUB_TOKEN=... node scripts/oss-stats.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const USER = 'felix-helleckes';
const README = new URL('../readme.md', import.meta.url);
const LATEST = 5;
const START = '<!-- oss:start -->';
const END = '<!-- oss:end -->';

async function search(query) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${USER}-oss-stats`,
        ...(process.env.GITHUB_TOKEN && {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        }),
      },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for "${query}"`);
    }
    const data = await res.json();
    total = data.total_count;
    items.push(...data.items);
    if (items.length >= total || data.items.length < 100) break;
  }
  return { total, items };
}

const repoName = (item) => item.repository_url.split('/repos/')[1];
const base = `author:${USER} -user:${USER}`;

const [merged, open, issues] = await Promise.all([
  search(`${base} type:pr is:merged`),
  search(`${base} type:pr is:open`),
  search(`${base} type:issue`),
]);

const repos = new Map();
const repo = (name) => {
  if (!repos.has(name)) repos.set(name, { name, merged: 0, open: 0 });
  return repos.get(name);
};
merged.items.forEach((item) => repo(repoName(item)).merged++);
open.items.forEach((item) => repo(repoName(item)).open++);

const repoRows = [...repos.values()]
  .sort((a, b) => b.merged - a.merged || b.open - a.open || a.name.localeCompare(b.name))
  .map((r) => `| [${r.name}](https://github.com/${r.name}) | ${r.merged} | ${r.open} |`);

const latest = merged.items
  .map((item) => ({ ...item, mergedAt: item.pull_request.merged_at ?? item.closed_at }))
  .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.html_url.localeCompare(a.html_url))
  .slice(0, LATEST)
  .map((pr) => {
    const title = pr.title.replace(/([\\[\]|])/g, '\\$1');
    return `- [${title}](${pr.html_url}) — ${repoName(pr)}, ${pr.mergedAt.slice(0, 10)}`;
  });

const body = (date) =>
  [
    START,
    '### 🔧 Open-source contributions (AI-assisted with Claude Code)',
    '',
    `**${merged.total} merged pull requests** in repositories I don't own<br>`,
    `<sub>+ ${open.total} more in review · ${issues.total} issues reported</sub>`,
    '',
    '| Repository | Merged | In review |',
    '|---|---:|---:|',
    ...repoRows,
    '',
    '**Latest merged**',
    '',
    ...latest,
    '',
    `<sub>Counted daily from the GitHub search API by a GitHub Action · last change ${date}</sub>`,
    END,
  ].join('\n');

const readme = readFileSync(README, 'utf8');
const from = readme.indexOf(START);
const to = readme.indexOf(END);
if (from === -1 || to < from) {
  throw new Error(`readme.md needs ${START} and ${END} markers`);
}
const current = readme.slice(from, to + END.length);

// Only rewrite (and re-date) the section when the numbers or PRs changed, so
// the daily run does not commit for nothing.
const withoutDate = (s) => s.replace(/last change \d{4}-\d{2}-\d{2}/, '');
if (withoutDate(current) === withoutDate(body('0000-00-00'))) {
  console.log('readme.md unchanged');
} else {
  const section = body(new Date().toISOString().slice(0, 10));
  writeFileSync(README, readme.slice(0, from) + section + readme.slice(to + END.length));
  console.log(`readme.md written: ${merged.total} merged, ${open.total} open, ${issues.total} issues`);
}
