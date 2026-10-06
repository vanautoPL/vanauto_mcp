#!/usr/bin/env node

// Stdio entry point: for local AI clients that launch the server as a child
// process (OpenCode, Claude Desktop, Cursor).
//
// Configuration:
//   VANAUTO_API_URL   - API base URL (default https://api.vanauto.pl)
//   VANAUTO_SITE_URL  - frontend base URL used to build listing links
//                       (default https://vanauto.pl)

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./app.js";

serveStdio(createServer);
