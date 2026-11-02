import fs from "fs";
import path from "path";
import { getPathHelpers } from "./paths.js";

const FINAL_STATUSES = new Set(["PASSED", "FAILED"]);

export default function createHtmlReporter(testName) {
  const { __dirname } = getPathHelpers(import.meta.url);
  const reportsDir = path.resolve(__dirname, "../reports");
  const summaryPath = path.join(reportsDir, "summary.json");

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const htmlFilePath = path.join(reportsDir, `${testName}.html`);
  const logs = [];

  function log(status, message) {
    const timestamp = new Date().toISOString();
    logs.push({ timestamp, status, message });
  }

  // The last PASSED/FAILED line a test writes (always in its finally block)
  // is its real verdict. Anything logged after a FAILED step but before that
  // line is a sub-step detail, not the outcome.
  function overallStatus() {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (FINAL_STATUSES.has(logs[i].status)) return logs[i].status;
    }
    return "UNKNOWN";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function generateHtmlReport() {
    const status = overallStatus();
    const counts = logs.reduce((acc, l) => ((acc[l.status] = (acc[l.status] || 0) + 1), acc), {});
    const finishedAt = logs.at(-1)?.timestamp || new Date().toISOString();

    const htmlContent = `
      <html>
      <head>
        <title>${testName} Report</title>
        <style>
          body { font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif; padding: 20px; background: #f9fafb; }
          h1 { color: #0077d3; margin-bottom: 10px; }
          .summary-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
          .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; color: #fff; }
          .status-badge.PASSED { background: #1a9e5c; }
          .status-badge.FAILED { background: #d6342c; }
          .status-badge.UNKNOWN { background: #888; }
          .counts { color: #555; font-size: 14px; }
          .finished-at { color: #888; font-size: 13px; }
          .log-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
          .log-table th, .log-table td { padding: 10px; text-align: left; }
          .log-table th { background: #0077d3; color: #fff; position: sticky; top: 0; }
          .INFO { color: #333; }
          .PASSED { color: green; font-weight: bold; }
          .FAILED { color: red; font-weight: bold; }
          .WARN { color: #b8860b; font-weight: bold; }
          tr { background: #fff; border-radius: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
          .status-cell { width: 80px; font-weight: bold; }
          .timestamp-cell { width: 180px; font-family: monospace; color: #555; }
          .message-cell { word-wrap: break-word; }
          .back-link { display: inline-block; margin-bottom: 20px; color: #0077d3; text-decoration: none; font-weight: bold; }
          .back-link:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Test Report: ${escapeHtml(testName)}</h1>
        <div class="summary-bar">
          <span class="status-badge ${status}">${status}</span>
          <span class="counts">${counts.PASSED || 0} passed step(s) &middot; ${counts.WARN || 0} warning(s) &middot; ${counts.FAILED || 0} failed step(s)</span>
          <span class="finished-at">Last run: ${finishedAt}</span>
        </div>
        <a class="back-link" href="./dashboard.html">&larr; Back to Dashboard</a>
        <table class="log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${logs
              .map(
                (l) =>
                  `<tr>
                    <td class="timestamp-cell">${escapeHtml(l.timestamp)}</td>
                    <td class="status-cell ${l.status}">${escapeHtml(l.status)}</td>
                    <td class="message-cell">${escapeHtml(l.message)}</td>
                  </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </body>
      </html>
    `;
    fs.writeFileSync(htmlFilePath, htmlContent, "utf-8");

    updateSummary(testName, { status, counts, finishedAt });
    updateDashboard();
  }

  return { log, generateHtmlReport, htmlFilePath };
}

function readSummary(summaryPath) {
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  } catch {
    return {};
  }
}

function updateSummary(testName, entry) {
  const { __dirname } = getPathHelpers(import.meta.url);
  const reportsDir = path.resolve(__dirname, "../reports");
  const summaryPath = path.join(reportsDir, "summary.json");

  const summary = readSummary(summaryPath);
  summary[testName] = entry;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
}

// Groups a test name into a category by its known filename prefixes, falling
// back to the part before its first underscore.
function categoryOf(testName) {
  if (testName.startsWith("Beacon_")) return "Beacons";
  if (testName.startsWith("Flow_") || testName === "Welcome_Tour_Flow") return "Flows";
  if (testName.startsWith("Write_Request_")) return "Popups";
  return testName.split("_")[0] || "Other";
}

function updateDashboard() {
  const { __dirname } = getPathHelpers(import.meta.url);
  const reportsDir = path.resolve(__dirname, "../reports");
  const dashboardPath = path.join(reportsDir, "dashboard.html");
  const summaryPath = path.join(reportsDir, "summary.json");

  // Every report that currently has an .html file, newest info first. A
  // report whose .html exists but has no summary entry (an older run,
  // before this format) shows as UNKNOWN rather than being hidden.
  const htmlFiles = fs
    .readdirSync(reportsDir)
    .filter((f) => f.endsWith(".html") && f !== "dashboard.html")
    .map((f) => path.basename(f, ".html"));

  const summary = readSummary(summaryPath);
  const rows = htmlFiles.map((name) => ({
    name,
    status: summary[name]?.status || "UNKNOWN",
    finishedAt: summary[name]?.finishedAt || "",
  }));

  const grouped = rows.reduce((acc, row) => {
    const cat = categoryOf(row.name);
    (acc[cat] ||= []).push(row);
    return acc;
  }, {});
  Object.values(grouped).forEach((group) => group.sort((a, b) => a.name.localeCompare(b.name)));

  const totalPassed = rows.filter((r) => r.status === "PASSED").length;
  const totalFailed = rows.filter((r) => r.status === "FAILED").length;
  const totalUnknown = rows.length - totalPassed - totalFailed;

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const sectionHtml = (cat, group) => `
    <h2>${escapeHtml(cat)}</h2>
    <ul>
      ${group
        .map(
          (r) => `<li>
            <span class="status-dot ${r.status}"></span>
            <a href="./${encodeURIComponent(r.name)}.html">${escapeHtml(r.name)}</a>
            <span class="status-label ${r.status}">${r.status}</span>
            ${r.finishedAt ? `<span class="finished-at">${escapeHtml(r.finishedAt)}</span>` : ""}
          </li>`
        )
        .join("")}
    </ul>
  `;

  const dashboardHtml = `
    <html>
    <head>
      <title>Test Reports Dashboard</title>
      <style>
        body { font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif; padding: 20px; background: #f4f6f8; }
        h1 { color: #0077d3; margin-bottom: 10px; }
        h2 { color: #333; margin-top: 30px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .totals { color: #555; margin-bottom: 20px; }
        ul { list-style: none; padding-left: 0; }
        li { margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        a { text-decoration: none; color: #0077d3; font-weight: bold; }
        a:hover { text-decoration: underline; }
        .status-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .status-dot.PASSED { background: #1a9e5c; }
        .status-dot.FAILED { background: #d6342c; }
        .status-dot.UNKNOWN { background: #aaa; }
        .status-label { font-size: 12px; font-weight: bold; padding: 2px 8px; border-radius: 10px; color: #fff; }
        .status-label.PASSED { background: #1a9e5c; }
        .status-label.FAILED { background: #d6342c; }
        .status-label.UNKNOWN { background: #aaa; }
        .finished-at { color: #999; font-size: 12px; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>Test Reports Dashboard</h1>
      <div class="totals">${rows.length} test(s) &middot; ${totalPassed} passed &middot; ${totalFailed} failed${totalUnknown ? ` &middot; ${totalUnknown} unknown` : ""}</div>
      ${Object.keys(grouped)
        .sort()
        .map((cat) => sectionHtml(cat, grouped[cat]))
        .join("")}
    </body>
    </html>
  `;
  fs.writeFileSync(dashboardPath, dashboardHtml, "utf-8");
}
