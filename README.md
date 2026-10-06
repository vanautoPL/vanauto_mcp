# VanAuto Campers MCP

Read-only MCP server that lets an AI client search and view VanAuto camper
listings, rentals and marketplace (akcesoria) offers. It talks to the public
VanAuto API, so it needs no credentials and cannot change any data.

**Public endpoint:** `https://mcp.vanauto.pl/mcp` (Streamable HTTP, no auth)
**MCP Registry:** [`pl.vanauto/campers`](https://registry.modelcontextprotocol.io/v0.1/servers?search=pl.vanauto/campers) — discoverable by registry-connected clients.

## Tools

| Tool | What it does |
|---|---|
| `search_campers` | Search active sale or rental listings with filters: text, make, model, camper type, fuel, gearbox, state, price, year, mileage, sleeping places, city; rentals also support availability dates. |
| `get_camper_details` | Full details for one listing by slug (auto-detects sale vs rental) or a camper spec sheet by `cam_...` id: decoded specs, photos, equipment, contact and links. |
| `list_camper_makes` | All 200+ camper makes with active sale/rental counts, for resolving brand names. |
| `list_camper_equipment` | The equipment catalog grouped by category. |
| `get_camper_market_stats` | Current snapshot: active listing counts, campers by body type, makes with inventory. |
| `search_marketplace_listings` | Search marketplace accessories with text, manufacturer, category, condition, compatibility, price, location filters. |
| `get_marketplace_listing_details` | Full accessory listing with seller info, shipping, photos, related offers. |

Data is served in Polish (as on the site); prices are in PLN. Rental rows
carry `dailyRates` (per-period rates) rather than a single price.

## Connect a client

### Remote (hosted)

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "vanauto-campers": {
      "type": "remote",
      "url": "https://mcp.vanauto.pl/mcp",
      "enabled": true
    }
  }
}
```

Claude / ChatGPT: add `https://mcp.vanauto.pl/mcp` as a custom connector.

Claude Desktop (older builds without native remote support):

```json
{
  "mcpServers": {
    "vanauto-campers": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.vanauto.pl/mcp"]
    }
  }
}
```

### Local (stdio)

Use an absolute path to `src/server.js` (see
[`mcp.config.example.json`](./mcp.config.example.json)):

```json
{
  "mcpServers": {
    "vanauto-campers": {
      "command": "node",
      "args": ["/path/to/mcp-campers/src/server.js"],
      "env": {
        "VANAUTO_API_URL": "https://api.vanauto.pl",
        "VANAUTO_SITE_URL": "https://vanauto.pl"
      }
    }
  }
}
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VANAUTO_API_URL` | `https://api.vanauto.pl` | API base URL. Point at `http://localhost:3000` to use a local Rails server. |
| `VANAUTO_SITE_URL` | `https://vanauto.pl` | Frontend base URL used to build listing links. |

## Development

```sh
npm install
npm start            # stdio server
npm run dev          # local HTTP endpoint at http://127.0.0.1:8787/mcp (wrangler dev)
```

## Checks

```sh
npm run check            # syntax check
npm run smoke            # live tool checks against the configured API
npm run smoke:protocol   # MCP handshake + tools/list + tools/call over stdio
npm run smoke:http       # same over HTTP: MCP_URL=https://mcp.vanauto.pl/mcp npm run smoke:http
```

## Deployment

The server runs as a Cloudflare Worker (`src/worker.js`); the stdio entry
(`src/server.js`) is for local clients. Both share the same tool factory in
`src/app.js`.

```sh
npx wrangler login       # once per machine
npx wrangler deploy      # deploys the Worker + mcp.vanauto.pl custom domain
```

Pushes to `main` deploy automatically via
`.github/workflows/deploy.yml`, which needs two repository secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id (Workers dashboard, right sidebar) |

The workflow runs `npm run smoke:http` against `https://mcp.vanauto.pl/mcp`
after each deploy.

## MCP Registry

The server is published to the official MCP Registry as `pl.vanauto/campers`
(namespace verified via a DNS TXT record on `vanauto.pl`). To publish a new
version after changing `server.json`:

```sh
# Signing key lives outside the repo, e.g. ~/.config/vanauto-mcp/registry-key.pem
PRIVATE_KEY="$(openssl pkey -in ~/.config/vanauto-mcp/registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain vanauto.pl --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

Keep `version` in `server.json` in sync with `package.json`; the registry
rejects duplicate versions.

## Behaviour notes

- **Read-only.** Every call is an HTTP GET against `/public/...`; there is no
  database access and no auth token.
- **Caching.** Catalog endpoints (makes, equipment) are cached in-process for
  an hour; searches and details for two minutes. The API itself also caches
  responses. On Workers, each isolate has its own short-lived instance of that
  cache.
- **Pagination.** `search_campers` returns up to 50 rows plus a `nextCursor`;
  pass it back as `after` for the next page. Marketplace search is page-based
  (`page`, `perPage`).
- **Truncation.** Long listing descriptions are trimmed (default 4000 chars,
  `maxDescriptionChars` to change), so one call cannot flood a model's context.
- Tool failures come back as `isError` results with a readable message, e.g. a
  missing slug reports "No active sale or rental listing found with slug ...".
