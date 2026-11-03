// Builds a static report site from reports/: an index page plus each test's
// report and screenshots. Usage: node scripts/build-report-site.mjs [outDir]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "reports");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "site"));
fs.mkdirSync(OUT, { recursive: true });
const summary = JSON.parse(fs.readFileSync(`${SRC}/summary.json`, "utf8"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const HEAD = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n';
// Strip machine-specific paths (local Mac or GitHub runner) from the reports
const clean = (t) => t.replace(/(?:\/Users\/[^/\s<&]+\/Downloads|\/home\/runner\/work\/[^/\s<&]+)\/playwright-boilerplate\//g, "");
const why = {};
for (const name of Object.keys(summary)) {
  const p = `${SRC}/${name}.html`;
  if (!fs.existsSync(p)) continue;
  const t = clean(fs.readFileSync(p, "utf8"));
  fs.writeFileSync(`${OUT}/${name}.html`, HEAD + t);
  const msgs = [...t.matchAll(/status-cell FAILED">FAILED<\/td>\s*<td class="message-cell">([\s\S]*?)<\/td>/g)].map((x) => x[1]);
  const first = msgs.find((x) => !/ failed\.$/.test(x.trim())) || msgs[0] || "";
  why[name] = unesc(first.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").replace(/^Test case failed with error:\s*/, "").trim().slice(0, 220);
}
for (const f of fs.readdirSync(SRC)) if (f.endsWith(".png")) fs.copyFileSync(`${SRC}/${f}`, `${OUT}/${f}`);
const groups = { Beacons: [], Flows: [], Popups: [] };
for (const [n, v] of Object.entries(summary)) groups[n.startsWith("Beacon") ? "Beacons" : n.startsWith("Write_Request") ? "Popups" : "Flows"].push([n, v]);
const total = Object.keys(summary).length;
const passed = Object.values(summary).filter((v) => v.status === "PASSED").length;
const last = new Date(Math.max(...Object.values(summary).map((v) => Date.parse(v.finishedAt))));
const when = last.toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
let rows = "";
for (const [g, items] of Object.entries(groups)) {
  rows += `<tr class="grp"><th colspan="3" scope="colgroup">${g}</th></tr>`;
  for (const [n, v] of items.sort()) {
    const ok = v.status === "PASSED";
    const shot = `${n}_failed.png`;
    const extra = fs.existsSync(`${OUT}/${shot}`) ? ` <a class="shot" href="${shot}">screenshot</a>` : "";
    const reason = ok ? "" : `<span class="why">${esc(why[n] || "")}</span>`;
    rows += `<tr><td><span class="pill ${ok ? "ok" : "bad"}">${ok ? "Passed" : "Failed"}</span></td><td><a href="${n}.html">${n.replace(/_/g, " ")}</a>${extra}${reason}</td><td class="t">${v.finishedAt.slice(11, 16)} UTC</td></tr>`;
  }
}
const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Whatfix Coupa Test Reports</title>
<style>
:root { --bg:#f5f6f8; --surface:#ffffff; --fg:#1b2430; --muted:#5d6b7c; --line:#dfe3e9; --ok:#13794b; --ok-bg:#e1f3ea; --bad:#b42318; --bad-bg:#fbe6e3; --link:#0b5fc4; --sans:system-ui,-apple-system,"Segoe UI",sans-serif; --mono:ui-monospace,SFMono-Regular,Menlo,monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#10161d; --surface:#18202a; --fg:#e6ebf1; --muted:#9aa8b8; --line:#2a3542; --ok:#5fd29b; --ok-bg:#12352a; --bad:#ff8f84; --bad-bg:#40201d; --link:#7db4f5; color-scheme:dark; } }
:root[data-theme="dark"] { --bg:#10161d; --surface:#18202a; --fg:#e6ebf1; --muted:#9aa8b8; --line:#2a3542; --ok:#5fd29b; --ok-bg:#12352a; --bad:#ff8f84; --bad-bg:#40201d; --link:#7db4f5; color-scheme:dark; }
body { background:var(--bg); color:var(--fg); font-family:var(--sans); font-size:15px; line-height:1.5; padding-block:32px; padding-left:max(16px,env(safe-area-inset-left,0px)); padding-right:max(16px,env(safe-area-inset-right,0px)); }
main { max-width:900px; margin:0 auto; }
h1 { font-size:1.7rem; margin:0 0 4px; text-wrap:balance; }
.sub { color:var(--muted); margin:0 0 24px; }
.totals { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
.totals div { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:10px 16px; min-width:110px; }
.totals b { display:block; font-size:1.6rem; font-variant-numeric:tabular-nums; }
.totals span { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; }
.totals .p b { color:var(--ok); } .totals .f b { color:var(--bad); }
.wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--line); border-radius:6px; }
table { border-collapse:collapse; width:100%; min-width:560px; }
td, th { padding:10px 14px; text-align:left; vertical-align:top; border-top:1px solid var(--line); }
tr.grp th { background:var(--bg); font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
tr.grp:first-child th { border-top:0; }
td.t { font-family:var(--mono); font-size:.8rem; color:var(--muted); white-space:nowrap; }
.pill { display:inline-block; font-size:.75rem; font-weight:600; padding:2px 10px; border-radius:10px; }
.pill.ok { background:var(--ok-bg); color:var(--ok); } .pill.bad { background:var(--bad-bg); color:var(--bad); }
a { color:var(--link); } a.shot { margin-left:10px; font-size:.85rem; }
.why { display:block; color:var(--muted); font-size:.85rem; margin-top:2px; overflow-wrap:anywhere; }
.foot { color:var(--muted); font-size:.85rem; margin-top:20px; }
</style>
<main>
<h1>Whatfix Coupa Test Reports</h1>
<p class="sub">Playwright checks of the Whatfix content on Coupa. Last full run: ${when}.</p>
<div class="totals"><div><b>${total}</b><span>Tests</span></div><div class="p"><b>${passed}</b><span>Passed</span></div><div class="f"><b>${total - passed}</b><span>Failed</span></div></div>
<div class="wrap"><table><tbody>${rows}</tbody></table></div>
<p class="foot">Open a test name for its step-by-step log. Updated after every test run.</p>
</main>
`;
fs.writeFileSync(`${OUT}/index.html`, page);
console.log(`Report site: ${OUT} (${passed}/${total} passed, ${when})`);
