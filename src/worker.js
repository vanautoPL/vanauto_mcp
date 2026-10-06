// Cloudflare Workers entry point: public Streamable HTTP endpoint at /mcp.
//
// The v2 SDK handler serves both the 2026-07-28 protocol revision and legacy
// 2025-era traffic, so remote clients (claude.ai connectors, ChatGPT
// connectors, OpenCode remote, mcp-remote) all work against one URL.
//
// Stateless by design: every request gets a fresh server from the factory, and
// the only shared state is the in-process response cache in api-client.js.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./app.js";

export default createMcpHandler(createServer, { legacy: "stateless" });
