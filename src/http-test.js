#!/usr/bin/env node

// HTTP protocol test: connects to a Streamable HTTP MCP endpoint (wrangler dev
// or a deployed Worker) and drives the tools through a real MCP client.
//
//   npm run dev                                  # terminal 1
//   MCP_URL=http://127.0.0.1:8787/mcp npm run smoke:http
//
// Defaults to the local wrangler dev endpoint.

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = new URL(process.env.MCP_URL || "http://127.0.0.1:8787/mcp");

const EXPECTED_TOOLS = [
  "search_campers",
  "get_camper_details",
  "list_camper_makes",
  "list_camper_equipment",
  "get_camper_market_stats",
  "search_marketplace_listings",
  "get_marketplace_listing_details",
];

let failed = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const client = new Client(
  { name: "vanauto-mcp-http-test", version: "0.1.0" },
  { versionNegotiation: { mode: "auto" } },
);

try {
  await client.connect(new StreamableHTTPClientTransport(url));
  console.log(`ok   connect - ${url}`);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of EXPECTED_TOOLS) {
    assert(names.includes(name), `missing tool ${name}`);
  }
  assert(names.length === EXPECTED_TOOLS.length, `tool count mismatch: ${names.length} vs ${EXPECTED_TOOLS.length}`);
  console.log(`ok   tools/list - ${names.length} tools`);

  const search = await client.callTool({
    name: "search_campers",
    arguments: { query: "citroen", limit: 2 },
  });
  assert(!search.isError, `search_campers failed: ${search.content?.[0]?.text}`);
  const payload = JSON.parse(search.content[0].text);
  assert(payload.totalCount > 0, "expected search results");
  console.log(`ok   tools/call search_campers - ${payload.totalCount} results`);

  const details = await client.callTool({
    name: "get_camper_details",
    arguments: { slug: payload.results[0].slug, segment: "sale", maxDescriptionChars: 200 },
  });
  assert(!details.isError, `get_camper_details failed: ${details.content?.[0]?.text}`);
  const detailPayload = JSON.parse(details.content[0].text);
  assert(detailPayload.camper?.id, "expected camper details");
  console.log(`ok   tools/call get_camper_details - camper ${detailPayload.camper.id}`);

  const stats = await client.callTool({ name: "get_camper_market_stats", arguments: {} });
  assert(!stats.isError, `get_camper_market_stats failed: ${stats.content?.[0]?.text}`);
  const statsPayload = JSON.parse(stats.content[0].text);
  console.log(`ok   tools/call get_camper_market_stats - ${statsPayload.activeSaleListings} active sale listings`);

  console.log("");
  console.log("http protocol test passed");
} catch (error) {
  failed = true;
  console.error(`FAIL ${error.message}`);
} finally {
  await client.close().catch(() => {});
}

if (failed) process.exitCode = 1;
