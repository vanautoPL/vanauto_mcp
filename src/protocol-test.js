#!/usr/bin/env node

// Protocol-level test: spawns the server over stdio and speaks MCP to it as a
// legacy-era client (initialize handshake), which is what most hosts - Claude
// Desktop, OpenCode, Cursor - use today. Verifies tools/list and a real
// tools/call round trip. Run with `npm run smoke:protocol`.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(here, "server.js")], { stdio: ["pipe", "pipe", "inherit"] });

const pending = new Map();
let buffer = "";
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

child.on("exit", (code) => {
  for (const [id, resolve] of pending) {
    pending.delete(id);
    resolve({ error: { message: `server exited with code ${code} before answering` } });
  }
});

function request(method, params, timeoutMs = 30_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let failed = false;

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vanauto-mcp-campers-protocol-test", version: "0.1.0" },
  });
  assert(init.result, `initialize failed: ${JSON.stringify(init.error)}`);
  console.log(`ok   initialize - ${init.result.serverInfo.name} ${init.result.serverInfo.version} (protocol ${init.result.protocolVersion})`);

  notify("notifications/initialized");

  const tools = await request("tools/list", {});
  const names = (tools.result?.tools ?? []).map((tool) => tool.name);
  const expected = [
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
  for (const name of expected) {
    assert(names.includes(name), `missing tool ${name}`);
  }
  console.log(`ok   tools/list - ${names.length} tools`);

  const search = await request("tools/call", {
    name: "search_campers",
    arguments: { query: "citroen", limit: 2 },
  });
  assert(search.result && !search.result.isError, `search_campers failed: ${search.result?.content?.[0]?.text}`);
  const payload = JSON.parse(search.result.content[0].text);
  assert(payload.totalCount > 0, "expected search results");
  console.log(`ok   tools/call search_campers - ${payload.totalCount} results, slug ${payload.results[0].slug}`);

  const details = await request("tools/call", {
    name: "get_camper_details",
    arguments: { slug: payload.results[0].slug, segment: "sale" },
  });
  assert(details.result && !details.result.isError, `get_camper_details failed: ${details.result?.content?.[0]?.text}`);
  const detailPayload = JSON.parse(details.result.content[0].text);
  assert(detailPayload.camper?.id, "expected camper details");
  console.log(`ok   tools/call get_camper_details - camper ${detailPayload.camper.id}`);

  const withPhotos = await request("tools/call", {
    name: "get_camper_details",
    arguments: { slug: payload.results[0].slug, segment: "sale", includePhotos: true, photoLimit: 2, maxDescriptionChars: 100 },
  });
  assert(withPhotos.result && !withPhotos.result.isError, `get_camper_details (photos) failed: ${withPhotos.result?.content?.[0]?.text}`);
  const imageBlocks = (withPhotos.result.content ?? []).filter((block) => block.type === "image");
  assert(imageBlocks.length > 0, "expected image content blocks");
  assert(imageBlocks[0].mimeType.startsWith("image/"), "expected an image mime type");
  assert(imageBlocks[0].data.length > 1000, "expected non-trivial base64 payload");
  console.log(`ok   tools/call get_camper_details + photos - ${imageBlocks.length} image(s)`);

  const stats = await request("tools/call", { name: "get_camper_market_stats", arguments: {} });
  assert(stats.result && !stats.result.isError, `get_camper_market_stats failed: ${stats.result?.content?.[0]?.text}`);
  console.log(`ok   tools/call get_camper_market_stats - ${JSON.parse(stats.result.content[0].text).activeSaleListings} active sale listings`);

  const prompts = await request("prompts/list", {});
  const promptNames = (prompts.result?.prompts ?? []).map((prompt) => prompt.name);
  const expectedPrompts = ["social-post", "price-check", "compare-campers", "seo-description"];
  for (const name of expectedPrompts) {
    assert(promptNames.includes(name), `missing prompt ${name}`);
  }
  console.log(`ok   prompts/list - ${promptNames.length} prompts`);

  const prompt = await request("prompts/get", {
    name: "price-check",
    arguments: { slug: payload.results[0].slug },
  });
  assert(prompt.result?.messages?.length > 0, `prompts/get failed: ${JSON.stringify(prompt.error)}`);
  console.log(`ok   prompts/get price-check - ${prompt.result.messages.length} message(s)`);

  console.log("");
  console.log("protocol test passed");
} catch (error) {
  failed = true;
  console.error(`FAIL ${error.message}`);
} finally {
  child.stdin.end();
  child.kill();
}

if (failed) process.exitCode = 1;
