// Shared MCP server factory.
//
// Used by both entry points:
//   - src/server.js  (stdio, for local AI clients)
//   - src/worker.js  (Streamable HTTP on Cloudflare Workers)
//
// Runtime-neutral on purpose: only web-standard APIs and the MCP SDK, so the
// same module runs under Node and workerd.

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  CAMPER_STATES,
  CAMPER_TYPES,
  FUEL_TYPES,
  RENTAL_SORTS,
  SALE_SORTS,
  TRANSMISSIONS,
  analyzeCamperPrices,
  fetchListingPhotos,
  findSimilarCampers,
  getCamperDetails,
  getMarketStats,
  getRentalReviews,
  listEquipment,
  listMakes,
  searchCampers,
} from "./campers.js";
import {
  MARKETPLACE_CONDITIONS,
  getMarketplaceListingDetails,
  getMarketplaceSeller,
  searchMarketplaceListings,
  searchWantedAds,
} from "./marketplace.js";

export const SERVER_NAME = "vanauto-campers";
export const SERVER_VERSION = "0.3.1";

const SORT_VALUES = [...new Set([...SALE_SORTS, ...RENTAL_SORTS])];

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };

export function createServer() {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "search_campers",
    {
      title: "Search campers",
      description:
        "Search active camper listings on VanAuto (vanauto.pl). Use segment \"sale\" for campers for sale " +
        "and \"rental\" for camper rentals. Returns compact rows with price, specs, city and a link to the " +
        "listing page. All listing text is in Polish. Prices are in PLN; for rentals, priceMin/priceMax " +
        "filter the daily/per-period rental rate.",
      inputSchema: z.object({
        segment: z.enum(["sale", "rental"]).default("sale").describe("Listing type: sale or rental."),
        query: z.string().optional().describe("Free-text search over the listing title and description."),
        make: z.string().optional().describe('Camper make, e.g. "Adria", "Fiat", "Benimar". Use list_camper_makes to resolve names.'),
        model: z.string().optional().describe('Camper model, e.g. "Ducato", "Jumper".'),
        camperType: z.enum(CAMPER_TYPES).optional().describe("Body type."),
        fuelType: z.enum(FUEL_TYPES).optional().describe("Fuel type."),
        transmission: z.enum(TRANSMISSIONS).optional().describe("Gearbox type."),
        state: z.enum(CAMPER_STATES).optional().describe("brand_new or pre_owned."),
        priceMin: z.number().nonnegative().optional().describe("Minimum price in PLN (sale price, or rental rate per period)."),
        priceMax: z.number().nonnegative().optional().describe("Maximum price in PLN (sale price, or rental rate per period)."),
        yearMin: z.number().int().min(1900).optional().describe("Earliest production year."),
        yearMax: z.number().int().max(2100).optional().describe("Latest production year."),
        mileageMax: z.number().int().nonnegative().optional().describe("Maximum mileage in km."),
        sleepingPlacesMin: z.number().int().positive().optional().describe("Minimum number of sleeping places."),
        city: z.string().optional().describe('City name in Polish, e.g. "Wrocław", "Kraków". Matched against the city catalog.'),
        availableFrom: z.string().optional().describe("Rental only: earliest pickup date (ISO, e.g. 2026-07-01)."),
        availableTo: z.string().optional().describe("Rental only: latest return date (ISO, e.g. 2026-07-14)."),
        sort: z.enum(SORT_VALUES).optional().describe("Sort order. Rental supports newest, price_asc, price_desc only."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum rows to return (1-50)."),
        after: z.string().optional().describe("Opaque cursor from a previous call (nextCursor) to fetch the next page."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => searchCampers(args)),
  );

  server.registerTool(
    "get_camper_details",
    {
      title: "Get camper details",
      description:
        "Get full details for one camper listing by slug (listing page id) or camper id (cam_...). " +
        'With a slug, searches sale listings first, then rentals; set segment to force "sale" or "rental". ' +
        "With camper_id, returns the camper spec sheet from the full catalog. Includes decoded specs, " +
        "photo URLs, equipment, contact details and the listing URL. Set includePhotos to also attach " +
        "actual camper photos as images so you can look at them.",
      inputSchema: z.object({
        slug: z.string().optional().describe("Listing slug from search results, e.g. citroen-jumper-ba12fa."),
        camperId: z.string().optional().describe("Camper public id, e.g. cam_4aJ62weNfqbS (from search results)."),
        segment: z.enum(["auto", "sale", "rental"]).default("auto").describe("Which listing space the slug belongs to."),
        includeDescription: z.boolean().default(true).describe("Include the listing description text."),
        maxDescriptionChars: z.number().int().min(0).max(20000).default(4000).describe("Description is truncated to this many characters."),
        includePhotos: z.boolean().default(false).describe("Attach camper photos as images (400px thumbnails) the model can actually see."),
        photoLimit: z.number().int().min(1).max(6).default(3).describe("How many photos to attach when includePhotos is true."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const value = await getCamperDetails(args);
        const content = [{ type: "text", text: JSON.stringify(value, null, 2) }];

        if (args.includePhotos) {
          const images = await fetchListingPhotos(value, { limit: args.photoLimit });
          for (const image of images) {
            content.push({ type: "image", data: image.data, mimeType: image.mimeType });
          }
        }

        return { content };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  server.registerTool(
    "list_camper_makes",
    {
      title: "List camper makes",
      description:
        "List camper makes (brands) known to VanAuto with how many active sale and rental listings each has. " +
        "Use this to resolve a brand name before searching.",
      inputSchema: z.object({
        query: z.string().optional().describe("Optional substring filter, e.g. \"ben\" for Benimar."),
        limit: z.number().int().min(1).max(250).default(250).describe("Maximum makes to return."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => listMakes(args)),
  );

  server.registerTool(
    "list_camper_equipment",
    {
      title: "List camper equipment",
      description:
        "List the camper equipment catalog grouped by category. Equipment names are English identifiers " +
        "used in listing filters and camper specs.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => toolResult(() => listEquipment()),
  );

  server.registerTool(
    "get_camper_market_stats",
    {
      title: "Get camper market stats",
      description:
        "Current VanAuto market snapshot: active sale and rental listing counts, campers by body type, " +
        "and makes with active inventory.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => toolResult(() => getMarketStats()),
  );

  server.registerTool(
    "analyze_camper_prices",
    {
      title: "Analyze camper prices",
      description:
        "Market price statistics for a cohort of active sale listings: min, max, average, median, " +
        "p25/p75 and counts, plus average price by production year. Optionally pass a listing slug " +
        "(slug) to see how that listing compares to the cohort (percentile and deviation from median). " +
        "Use this to answer \"is this a good price?\".",
      inputSchema: z.object({
        make: z.string().optional().describe('Cohort make, e.g. "Adria". Use list_camper_makes to resolve names.'),
        model: z.string().optional().describe("Cohort model."),
        camperType: z.enum(CAMPER_TYPES).optional().describe("Body type."),
        fuelType: z.enum(FUEL_TYPES).optional().describe("Fuel type."),
        transmission: z.enum(TRANSMISSIONS).optional().describe("Gearbox type."),
        state: z.enum(CAMPER_STATES).optional().describe("brand_new or pre_owned."),
        yearMin: z.number().int().min(1900).optional().describe("Earliest production year in the cohort."),
        yearMax: z.number().int().max(2100).optional().describe("Latest production year in the cohort."),
        mileageMax: z.number().int().nonnegative().optional().describe("Maximum mileage in km."),
        city: z.string().optional().describe('City name in Polish, e.g. "Wrocław".'),
        slug: z.string().optional().describe("Sale listing slug to compare against the cohort."),
        maxSample: z.number().int().min(5).max(500).default(200).describe("Maximum listings to sample for statistics."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => analyzeCamperPrices(args)),
  );

  server.registerTool(
    "find_similar_campers",
    {
      title: "Find similar campers",
      description:
        "Find sale listings similar to a given one (same market segment, price bracket and specs). " +
        "Returns compact rows for the alternatives the platform suggests.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Sale listing slug from search results."),
        limit: z.number().int().min(1).max(20).default(6).describe("Maximum alternatives to return."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => findSimilarCampers(args)),
  );

  server.registerTool(
    "get_rental_reviews",
    {
      title: "Get rental reviews",
      description:
        "Published customer reviews for a rental listing (id from search results, e.g. rls_...). " +
        "Returns ratings and review text. Sale listings do not have reviews.",
      inputSchema: z.object({
        rentalListingId: z.string().min(1).describe("Rental listing id from search results, e.g. rls_A50UmVqECBDt."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum reviews to return."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => getRentalReviews(args)),
  );

  server.registerTool(
    "search_marketplace_listings",
    {
      title: "Search marketplace listings",
      description:
        "Search the VanAuto marketplace (akcesoria - camper parts and accessories). Supports text, " +
        "manufacturer, category, condition, compatibility and price filters. Returns compact rows plus " +
        "facets with category/condition counts.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free-text search over title and description."),
        manufacturer: z.string().optional().describe("Manufacturer/brand text filter."),
        category: z.string().optional().describe('Category slug, e.g. "appliances", "plumbing_water".'),
        subcategory: z.string().optional().describe('Subcategory slug, e.g. "toilets", "refrigeration".'),
        condition: z.enum(MARKETPLACE_CONDITIONS).optional().describe("Item condition."),
        compatibility: z.string().optional().describe("Camper compatibility tag."),
        priceMin: z.number().nonnegative().optional().describe("Minimum price in PLN."),
        priceMax: z.number().nonnegative().optional().describe("Maximum price in PLN."),
        location: z.string().optional().describe("City name or postal code text filter."),
        page: z.number().int().min(1).max(1000).default(1).describe("Page number (1-based)."),
        perPage: z.number().int().min(1).max(50).default(20).describe("Rows per page (1-50)."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => searchMarketplaceListings(args)),
  );

  server.registerTool(
    "get_marketplace_listing_details",
    {
      title: "Get marketplace listing details",
      description:
        "Get full details for one marketplace (akcesoria) listing by slug: price, condition, shipping, " +
        "compatibility, seller, photos and links. Optionally includes related offers and the seller's " +
        "other listings.",
      inputSchema: z.object({
        slug: z.string().min(1).describe("Marketplace listing slug from search results."),
        includeRelated: z.boolean().default(true).describe("Include related and seller's other listings."),
        maxDescriptionChars: z.number().int().min(0).max(20000).default(4000).describe("Description is truncated to this many characters."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => getMarketplaceListingDetails(args)),
  );

  server.registerTool(
    "get_marketplace_seller",
    {
      title: "Get marketplace seller",
      description:
        "Marketplace seller profile by id (from a marketplace listing's seller): display name, " +
        "verification and trust badges, ratings and reputation, plus their active offers.",
      inputSchema: z.object({
        sellerId: z.string().min(1).describe("Seller public id, e.g. usr_Fz1bpXt90L9Y."),
        includeListings: z.boolean().default(true).describe("Include the seller's active marketplace listings."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => getMarketplaceSeller(args)),
  );

  server.registerTool(
    "search_wanted_ads",
    {
      title: "Search wanted ads",
      description:
        "Search marketplace wanted ads (kupię / poszukuję) posted by buyers looking for camper parts " +
        "and accessories. Supports text, category and subcategory filters.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free-text search over title, description, manufacturer and part number."),
        category: z.string().optional().describe('Category slug, e.g. "appliances", "plumbing_water".'),
        subcategory: z.string().optional().describe('Subcategory slug, e.g. "toilets", "refrigeration".'),
        page: z.number().int().min(1).max(1000).default(1).describe("Page number (1-based)."),
        perPage: z.number().int().min(1).max(50).default(12).describe("Rows per page (1-50)."),
      }),
      annotations: READ_ONLY,
    },
    (args) => toolResult(() => searchWantedAds(args)),
  );

  registerPrompts(server);

  return server;
}

function registerPrompts(server) {
  server.registerPrompt(
    "social-post",
    {
      title: "Social post for a camper",
      description: "Write a Polish social-media post (Facebook/Instagram) for one camper listing.",
      argsSchema: z.object({
        slug: z.string().min(1).describe("Listing slug, e.g. citroen-jumper-ba12fa."),
        platform: z.enum(["Facebook", "Instagram", "OLX"]).default("Facebook").describe("Target platform."),
      }),
    },
    ({ slug, platform }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Użyj narzędzia get_camper_details dla ogłoszenia o slug "${slug}", a następnie napisz po polsku ` +
              `chwytliwy post na ${platform} sprzedający tego kampera. Wykorzystaj najważniejsze dane: marka, model, ` +
              "rocznik, przebieg, cena, wyposażenie i lokalizacja. Dodaj 3-5 trafnych hashtagów i link do ogłoszenia. " +
              "Nie wymyślaj danych, których nie ma w ogłoszeniu.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "price-check",
    {
      title: "Check if a camper price is fair",
      description: "Compare one listing against the market cohort and give a Polish verdict on its price.",
      argsSchema: z.object({
        slug: z.string().min(1).describe("Sale listing slug, e.g. citroen-jumper-ba12fa."),
      }),
    },
    ({ slug }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Najpierw pobierz dane ogłoszenia narzędziem get_camper_details (slug "${slug}"). ` +
              "Następnie użyj analyze_camper_prices z filtrami pasującymi do tego kampera (marka, typ, rocznik, " +
              "przebieg; ten sam slug jako punkt odniesienia). Napisz po polsku krótką ocenę ceny: czy jest poniżej, " +
              "w okolicy czy powyżej mediany rynku, ile wynosi różnica w procentach i na ile wiarygodna jest próbka " +
              "(sampleSize). Podaj widełki rynkowe (p25-p75).",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "compare-campers",
    {
      title: "Compare camper listings",
      description: "Compare 2-4 sale listings side by side and recommend the best fit.",
      argsSchema: z.object({
        slugs: z.string().min(1).describe("Comma-separated listing slugs, 2-4 of them."),
        needs: z.string().optional().describe("Buyer needs, e.g. 'rodzina 2+2, zimowy, automat'."),
      }),
    },
    ({ slugs, needs }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Pobierz szczegóły każdego z tych ogłoszeń narzędziem get_camper_details: ${slugs}. ` +
              (needs ? `Potrzeby kupującego: ${needs}. ` : "") +
              "Porównaj je po polsku w tabeli: cena, rocznik, przebieg, silnik i skrzynia, miejsca sypialne, " +
              "wyposażenie, lokalizacja. Na końcu wskaż rekomendację i uzasadnij ją w 2-3 zdaniach.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "seo-description",
    {
      title: "SEO description for a camper",
      description: "Rewrite a listing's description as an SEO-friendly Polish text.",
      argsSchema: z.object({
        slug: z.string().min(1).describe("Listing slug, e.g. citroen-jumper-ba12fa."),
      }),
    },
    ({ slug }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Użyj get_camper_details dla ogłoszenia "${slug}". Na podstawie danych i oryginalnego opisu napisz ` +
              "po polsku ulepszony opis ogłoszenia: 3 akapity, naturalnie wplecione słowa kluczowe (marka, model, " +
              "typ kampera, rocznik, cechy), bez emoji i bez danych, których nie ma w ogłoszeniu. Zachowaj wszystkie " +
              "istotne informacje techniczne i kontaktowe.",
          },
        },
      ],
    }),
  );
}

async function toolResult(run) {
  try {
    const value = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
}
