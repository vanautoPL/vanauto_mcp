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
  "analyze_camper_prices",
  "find_similar_campers",
  "get_rental_reviews",
  "search_marketplace_listings",
  "get_marketplace_listing_details",
  "get_marketplace_seller",
  "search_wanted_ads",
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

  const healthResponse = await fetch(new URL("/health", url));
  assert(healthResponse.ok, `health check returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  assert(health.status === "ok", `unexpected health payload: ${JSON.stringify(health)}`);
  console.log(`ok   /health - ${health.name} ${health.version}`);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const name of EXPECTED_TOOLS) {
    assert(names.includes(name), `missing tool ${name}`);
  }
  assert(names.length === EXPECTED_TOOLS.length, `tool count mismatch: ${names.length} vs ${EXPECTED_TOOLS.length}`);
  console.log(`ok   tools/list - ${names.length} tools`);

  const { prompts } = await client.listPrompts();
  const promptNames = prompts.map((prompt) => prompt.name);
  for (const name of ["social-post", "price-check", "compare-campers", "seo-description"]) {
    assert(promptNames.includes(name), `missing prompt ${name}`);
  }
  console.log(`ok   prompts/list - ${promptNames.length} prompts`);

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

  const withPhotos = await client.callTool({
    name: "get_camper_details",
    arguments: { slug: payload.results[0].slug, segment: "sale", includePhotos: true, photoLimit: 2, maxDescriptionChars: 100 },
  });
  assert(!withPhotos.isError, `get_camper_details (photos) failed: ${withPhotos.content?.[0]?.text}`);
  const imageBlocks = (withPhotos.content ?? []).filter((block) => block.type === "image");
  assert(imageBlocks.length > 0, "expected image content blocks");
  assert(imageBlocks[0].mimeType.startsWith("image/"), "expected an image mime type");
  console.log(`ok   tools/call get_camper_details + photos - ${imageBlocks.length} image(s)`);

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
