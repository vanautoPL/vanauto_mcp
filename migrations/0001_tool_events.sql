-- Anonymous tool-usage events for the public MCP server.
--
-- Deliberately stores no IP addresses, user agents, tokens or identifiers:
-- only the tool name, sanitized filter arguments (truncated), outcome,
-- duration and a coarse client family parsed from the user agent.

CREATE TABLE IF NOT EXISTS tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  tool TEXT NOT NULL,
  segment TEXT,
  args_json TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  client TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_events_created_at ON tool_events (created_at);
CREATE INDEX IF NOT EXISTS idx_tool_events_tool ON tool_events (tool);
