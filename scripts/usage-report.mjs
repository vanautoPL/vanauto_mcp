#!/usr/bin/env node

// Usage report for the public MCP server, read from the Cloudflare D1
// analytics database. Requires a one-time `npx wrangler login`.
//
//   npm run usage:report
//   npm run usage:report -- --days 7

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const days = parseDays(process.argv.slice(2));
const since = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')`;

async function d1(sql) {
  const { stdout } = await execFileAsync(
    "npx",
    ["wrangler", "d1", "execute", "vanauto-mcp-usage", "--remote", "--json", "--command", sql],
    { maxBuffer: 20 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout);
  return parsed?.[0]?.results ?? [];
}

function parseDays(args) {
  const index = args.indexOf("--days");
  if (index === -1) return 30;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30;
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log("  (no data)");
    return;
  }

  const widths = columns.map((column) =>
    Math.max(column.label.length, ...rows.map((row) => String(row[column.key] ?? "").length)),
  );

  const header = columns.map((column, i) => column.label.padEnd(widths[i])).join("  ");
  console.log(`  ${header}`);
  for (const row of rows) {
    const line = columns.map((column, i) => String(row[column.key] ?? "").padEnd(widths[i])).join("  ");
    console.log(`  ${line}`);
  }
}

console.log(`VanAuto MCP usage - last ${days} days`);
console.log("");

const [summary] = await d1(`
  SELECT
    COUNT(*) AS total_calls,
    SUM(ok) AS ok_calls,
    COUNT(DISTINCT client) AS client_families
  FROM tool_events
  WHERE created_at >= ${since}
`);

console.log("Summary");
console.log(`  total calls:    ${summary?.total_calls ?? 0}`);
console.log(`  successful:     ${summary?.ok_calls ?? 0}`);
console.log(`  client families:${summary?.client_families ?? 0}`);
console.log("");

console.log("Calls by tool");
printTable(
  await d1(`
    SELECT tool, COUNT(*) AS calls, SUM(ok) AS ok, ROUND(AVG(duration_ms)) AS avg_ms
    FROM tool_events
    WHERE created_at >= ${since}
    GROUP BY tool
    ORDER BY calls DESC
  `),
  [
    { key: "tool", label: "tool" },
    { key: "calls", label: "calls" },
    { key: "ok", label: "ok" },
    { key: "avg_ms", label: "avg ms" },
  ],
);
console.log("");

console.log("Clients");
printTable(
  await d1(`
    SELECT client, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since}
    GROUP BY client
    ORDER BY calls DESC
  `),
  [
    { key: "client", label: "client" },
    { key: "calls", label: "calls" },
  ],
);
console.log("");

console.log("Rental vs sale searches");
printTable(
  await d1(`
    SELECT segment, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since} AND segment IS NOT NULL
    GROUP BY segment
    ORDER BY calls DESC
  `),
  [
    { key: "segment", label: "segment" },
    { key: "calls", label: "calls" },
  ],
);
console.log("");

console.log("Top search phrases");
printTable(
  await d1(`
    SELECT json_extract(args_json, '$.query') AS query, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since}
      AND json_extract(args_json, '$.query') IS NOT NULL
      AND length(trim(json_extract(args_json, '$.query'))) > 0
    GROUP BY query
    ORDER BY calls DESC
    LIMIT 15
  `),
  [
    { key: "query", label: "query" },
    { key: "calls", label: "calls" },
  ],
);
console.log("");

console.log("Top requested makes");
printTable(
  await d1(`
    SELECT json_extract(args_json, '$.make') AS make, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since}
      AND json_extract(args_json, '$.make') IS NOT NULL
    GROUP BY make
    ORDER BY calls DESC
    LIMIT 15
  `),
  [
    { key: "make", label: "make" },
    { key: "calls", label: "calls" },
  ],
);
console.log("");

console.log("Top requested camper types");
printTable(
  await d1(`
    SELECT json_extract(args_json, '$.camperType') AS camper_type, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since}
      AND json_extract(args_json, '$.camperType') IS NOT NULL
    GROUP BY camper_type
    ORDER BY calls DESC
  `),
  [
    { key: "camper_type", label: "type" },
    { key: "calls", label: "calls" },
  ],
);
console.log("");

console.log("Calls per day");
printTable(
  await d1(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS calls
    FROM tool_events
    WHERE created_at >= ${since}
    GROUP BY day
    ORDER BY day DESC
  `),
  [
    { key: "day", label: "day" },
    { key: "calls", label: "calls" },
  ],
);
