// Cloudflare Workers entry point: public Streamable HTTP endpoint at /mcp,
// plus a small /health route for humans and uptime checks.
//
// The v2 SDK handler serves both the 2026-07-28 protocol revision and legacy
// 2025-era traffic, so remote clients (claude.ai connectors, ChatGPT
// connectors, OpenCode remote, mcp-remote) all work against one URL.
//
// Stateless by design: every request gets a fresh server from the factory. The
// handler is created per request so tool callbacks can reach this request's D1
// binding and waitUntil for anonymous usage analytics.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./app.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/health") {
      return Response.json({
        status: "ok",
        name: SERVER_NAME,
        version: SERVER_VERSION,
        mcp: "/mcp",
      });
    }

    const handler = createMcpHandler(
      () => createServer({ onToolCall: (event) => recordToolEvent(env, ctx, request, event) }),
      { legacy: "stateless" },
    );

    return handler.fetch(request);
  },
};

// ── Anonymous usage analytics ───────────────────────────────────────────────
// One row per tool call: tool name, sanitized (truncated) arguments, outcome,
// duration and a coarse client family. No IP addresses, tokens or identifiers
// are stored. Report with `npm run usage:report`; schema in migrations/.

function recordToolEvent(env, ctx, request, event) {
  const database = env?.USAGE_DB;
  if (!database) return;

  const statement = database
    .prepare(
      "INSERT INTO tool_events (tool, segment, args_json, ok, duration_ms, client) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      event.tool,
      segmentOf(event.args),
      sanitizeArgs(event.args),
      event.ok ? 1 : 0,
      event.durationMs ?? null,
      detectClient(request.headers.get("user-agent")),
    );

  // Fire-and-forget: analytics must never delay or break a tool response.
  ctx.waitUntil(statement.run().catch(() => {}));
}

function segmentOf(args) {
  return typeof args?.segment === "string" ? args.segment : null;
}

function sanitizeArgs(args) {
  try {
    const json = JSON.stringify(args ?? {}, (key, value) =>
      typeof value === "string" ? value.slice(0, 120) : value,
    );
    return json.length > 1200 ? json.slice(0, 1200) : json;
  } catch {
    return null;
  }
}

function detectClient(userAgent) {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("chatgpt") || ua.includes("openai")) return "chatgpt";
  if (ua.includes("claude")) return "claude";
  if (ua.includes("opencode")) return "opencode";
  if (ua.includes("cursor")) return "cursor";
  if (ua.includes("mcp-remote")) return "mcp-remote";
  if (ua.includes("inspector")) return "inspector";
  if (ua.includes("node")) return "node";
  return "other";
}
