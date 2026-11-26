// Draws the profile's contribution graph as a "bug sweep": a scanner beam runs across the
// last year like a test run, lighting up each week as it passes. Pure SVG + SMIL, no deps.
// Usage: GITHUB_TOKEN=... node scripts/bug-sweep.mjs <login> <out.svg>
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import assert from "node:assert";

const [login = "ProtitiPrachi", out = "dist/bug-sweep.svg"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

const query = `query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar {
  totalContributions weeks { contributionDays { contributionCount date weekday contributionLevel } } } } } }`;
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "bug-sweep" },
  body: JSON.stringify({ query, variables: { login } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
const cal = json.data.user.contributionsCollection.contributionCalendar;
const weeks = cal.weeks;

/* ---------------------------------------------------------------- stats */
const days = weeks.flatMap((w) => w.contributionDays);
const sum = days.reduce((n, d) => n + d.contributionCount, 0);
assert.equal(sum, cal.totalContributions, "day counts must add up to the total");
const active = days.filter((d) => d.contributionCount > 0).length;
let streak = 0, run = 0;
for (const d of days) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  streak = Math.max(streak, run);
}

/* --------------------------------------------------------------- layout */
const W = 960, H = 250, X0 = 64, Y0 = 70, STEP = 16, CELL = 12;
const DUR = 10, T0 = 0.6, T1 = 8; // seconds: sweep runs from T0 to T1, then the summary holds
const cols = weeks.length;
const colTime = (i) => T0 + ((T1 - T0) * i) / Math.max(1, cols - 1);
const k = (t) => (t / DUR).toFixed(4); // seconds -> keyTime
const FILL = {
  NONE: "#1b1f2a",
  FIRST_QUARTILE: "#4d5e1c",
  SECOND_QUARTILE: "#7d9c25",
  THIRD_QUARTILE: "#abd335",
  FOURTH_QUARTILE: "#d9ff4f",
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

let grid = "", pulses = "", months = "";
let lastMonth = "";
weeks.forEach((w, i) => {
  const x = X0 + i * STEP;
  const tc = colTime(i);
  const first = w.contributionDays[0];
  const month = new Date(first.date + "T00:00:00Z").toLocaleString("en", { month: "short", timeZone: "UTC" });
  if (month !== lastMonth && i < cols - 2) {
    months += `<text x="${x}" y="${Y0 - 10}">${month}</text>`;
    lastMonth = month;
  }
  let cells = "";
  for (const d of w.contributionDays) {
    const y = Y0 + d.weekday * STEP;
    cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${FILL[d.contributionLevel] ?? FILL.NONE}"><title>${esc(d.date)}: ${d.contributionCount}</title></rect>`;
    if (d.contributionCount > 0) {
      // a ring pops out of every day with contributions as the beam passes it
      const cx = x + CELL / 2, cy = y + CELL / 2;
      pulses += `<circle cx="${cx}" cy="${cy}" r="0" fill="none" stroke="#d9ff4f" stroke-width="1.5" opacity="0">
<animate attributeName="r" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(tc)};${k(tc + 0.7)};1" values="0;0;11;11"/>
<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(tc)};${k(tc + 0.7)};1" values="0;0.9;0;0"/></circle>`;
    }
  }
  // the whole week column brightens when the beam reaches it, and dims again before the loop restarts
  grid += `<g opacity="0.18">${cells}<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(tc)};${k(tc + 0.25)};${k(9.4)};1" values="0.18;0.18;1;1;0.18"/></g>`;
});

const gridW = cols * STEP;
const beamFrom = X0 - 30, beamTo = X0 + gridW + 6;
const beam = `<g opacity="0">
<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(T0 - 0.2)};${k(T0)};${k(T1)};${k(T1 + 0.3)};1" values="0;0;1;1;0;0"/>
<animateTransform attributeName="transform" type="translate" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(T0)};${k(T1)};1" values="${beamFrom} 0;${beamFrom} 0;${beamTo} 0;${beamTo} 0"/>
<rect x="0" y="${Y0 - 6}" width="26" height="${7 * STEP + 8}" fill="url(#beam)"/>
<rect x="25" y="${Y0 - 6}" width="2" height="${7 * STEP + 8}" fill="#d9ff4f"/>
<g transform="translate(26 ${Y0 - 34})"><circle r="9" fill="#08090d" stroke="#d9ff4f" stroke-width="2.5"/><path d="M6.5 6.5 L13 13" stroke="#d9ff4f" stroke-width="3" stroke-linecap="round"/></g>
</g>`;

const summary = `✓ ${cols} weeks tested · ${cal.totalContributions} contributions · ${active} active days · longest streak ${streak} day${streak === 1 ? "" : "s"} · 0 bugs found`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cal.totalContributions)} contributions in the last year, ${active} active days, longest streak ${streak} days">
<title>${esc(cal.totalContributions)} contributions in the last year</title>
<defs><linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="#d9ff4f" stop-opacity="0"/><stop offset="1" stop-color="#d9ff4f" stop-opacity="0.35"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="16" fill="#0d0f15" stroke="#22252f"/>
<text x="28" y="32" font-family="Consolas, Menlo, monospace" font-size="14"><tspan fill="#a1a2ad">$ </tspan><tspan fill="#d9ff4f">bug-sweep</tspan><tspan fill="#f3f1ea"> --user ${esc(login)} --last-year</tspan></text>
<g font-family="Consolas, Menlo, monospace" font-size="11" fill="#a1a2ad">${months}
<text x="${X0 - 10}" y="${Y0 + 1 * STEP + 10}" text-anchor="end">Mon</text><text x="${X0 - 10}" y="${Y0 + 3 * STEP + 10}" text-anchor="end">Wed</text><text x="${X0 - 10}" y="${Y0 + 5 * STEP + 10}" text-anchor="end">Fri</text></g>
${grid}
${pulses}
${beam}
<text x="28" y="${H - 26}" font-family="Consolas, Menlo, monospace" font-size="13" fill="#4ade80" opacity="0">${esc(summary)}
<animate attributeName="opacity" dur="${DUR}s" repeatCount="indefinite" keyTimes="0;${k(T1)};${k(T1 + 0.4)};${k(9.5)};1" values="0;0;1;1;0"/></text>
<g transform="translate(${W - 150} ${H - 38})" font-family="Consolas, Menlo, monospace" font-size="11" fill="#a1a2ad">
<text x="0" y="12">less</text>${Object.values(FILL).map((c, i) => `<rect x="${32 + i * 15}" y="2" width="11" height="11" rx="3" fill="${c}"/>`).join("")}<text x="110" y="12">more</text></g>
</svg>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out}: ${cal.totalContributions} contributions, ${active} active days, streak ${streak}`);
