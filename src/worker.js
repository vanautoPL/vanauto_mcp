// Cloudflare Workers entry point: public Streamable HTTP endpoint at /mcp,
// plus a small /health route for humans and uptime checks.
//
// The v2 SDK handler serves both the 2026-07-28 protocol revision and legacy
// 2025-era traffic, so remote clients (claude.ai connectors, ChatGPT
// connectors, OpenCode remote, mcp-remote) all work against one URL.
//
// Stateless by design: every request gets a fresh server from the factory, and
// the only shared state is the in-process response cache in api-client.js.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./app.js";

const mcpHandler = createMcpHandler(createServer, { legacy: "stateless" });

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/health") {
      return Response.json({
        status: "ok",
        name: SERVER_NAME,
        version: SERVER_VERSION,
        mcp: "/mcp",
      });
    }

    return mcpHandler.fetch(request);
  },
};
