#!/usr/bin/env node

// Live smoke test: exercises the tool logic against the configured VanAuto
// API (production by default). Run with `npm run smoke`.
//
//   VANAUTO_API_URL=http://localhost:3000 npm run smoke

import {
  analyzeCamperPrices,
  findSimilarCampers,
  getCamperDetails,
  getMarketStats,
  getRentalReviews,
  listEquipment,
  listMakes,
  searchCampers,
} from "./campers.js";
import {
  getMarketplaceListingDetails,
  getMarketplaceSeller,
  searchMarketplaceListings,
  searchWantedAds,
} from "./marketplace.js";
import { apiBaseUrl, siteBaseUrl } from "./api-client.js";

let failures = 0;
let passed = 0;

async function check(name, run) {
  try {
    const detail = await run();
    passed += 1;
    console.log(`ok   ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`VanAuto campers MCP smoke test`);
console.log(`  API:  ${apiBaseUrl()}`);
console.log(`  Site: ${siteBaseUrl()}`);
console.log("");

let saleSlug = null;
let rentalSlug = null;
let rentalListingId = null;
let marketplaceSlug = null;
let marketplaceSellerId = null;

await check("search_campers (sale, text query)", async () => {
  const result = await searchCampers({ segment: "sale", query: "citroen", limit: 5 });
  assert(result.totalCount > 0, "expected at least one Citroen listing");
  assert(result.results.length > 0, "expected result rows");
  const first = result.results[0];
  assert(first.slug, "expected a slug on the first result");
  assert(first.url.includes("/ogloszenie/"), `expected a sale URL, got ${first.url}`);
  assert(first.camper && typeof first.camper === "object", "expected camper summary");
  saleSlug = first.slug;
  return `${result.totalCount} results, first: ${first.title}`;
});

await check("search_campers (sale, city filter)", async () => {
  const result = await searchCampers({ segment: "sale", city: "Wrocław", limit: 3 });
  assert(result.appliedFilters.city?.name, "expected resolved city in appliedFilters");
  assert(result.appliedFilters.city.matchedExactly === true, "expected exact city match");
  return `${result.totalCount} results in ${result.appliedFilters.city.name}`;
});

await check("get_camper_details (sale by slug)", async () => {
  assert(saleSlug, "no sale slug captured from search");
  const details = await getCamperDetails({ slug: saleSlug, segment: "sale" });
  assert(details.segment === "sale", `expected sale segment, got ${details.segment}`);
  assert(details.listingId, "expected listingId");
  assert(details.url.includes("/ogloszenie/"), `expected sale URL, got ${details.url}`);
  assert(details.camper?.id, "expected camper spec");
  assert(Array.isArray(details.camper.photos), "expected photos array");
  assert(typeof details.description === "string", "expected description string");
  return `${details.camper.make?.name ?? "?"} ${details.camper.model ?? ""} ${details.camper.year ?? ""}, ${details.camper.photos.length} photos`;
});

await check("search_campers (rental)", async () => {
  const result = await searchCampers({ segment: "rental", limit: 5 });
  assert(result.results.length > 0, "expected at least one rental listing");
  const first = result.results[0];
  assert(first.url.includes("/wynajem/"), `expected a rental URL, got ${first.url}`);
  assert(Array.isArray(first.dailyRates), "expected dailyRates array");
  rentalSlug = first.slug;
  return `${result.totalCount} rentals, first: ${first.title}`;
});

await check("get_camper_details (rental by slug)", async () => {
  assert(rentalSlug, "no rental slug captured from search");
  const details = await getCamperDetails({ slug: rentalSlug, segment: "rental" });
  assert(details.segment === "rental", `expected rental segment, got ${details.segment}`);
  assert(details.dailyRates.length > 0, "expected at least one rental price");
  assert(details.url.includes("/wynajem/"), `expected rental URL, got ${details.url}`);
  rentalListingId = details.listingId;
  const base = details.dailyRates.find((rate) => rate.isBaseRate) ?? details.dailyRates[0];
  return `${base.price} ${base.currency} / ${base.period}`;
});

await check("get_camper_details (camper id from catalog)", async () => {
  const details = await getCamperDetails({ slug: saleSlug, segment: "sale" });
  const camperId = details.camper.id;
  const catalog = await getCamperDetails({ camperId });
  assert(catalog.segment === "camper", `expected camper segment, got ${catalog.segment}`);
  assert(catalog.camper.id === camperId, "catalog camper id mismatch");
  return `${catalog.camper.make?.name ?? "?"} ${catalog.camper.model ?? ""} (${catalog.camper.id})`;
});

await check("list_camper_makes", async () => {
  const result = await listMakes({});
  assert(result.count > 100, `expected >100 makes, got ${result.count}`);
  const withInventory = result.makes.filter((make) => make.saleListingsCount > 0);
  assert(withInventory.length > 0, "expected makes with active sale listings");
  return `${result.count} makes, ${withInventory.length} with active inventory`;
});

await check("list_camper_equipment", async () => {
  const result = await listEquipment();
  assert(result.categories.length > 0, "expected equipment categories");
  const total = result.categories.reduce((sum, category) => sum + category.equipments.length, 0);
  assert(total > 0, "expected equipment items");
  return `${result.categories.length} categories, ${total} items`;
});

await check("get_camper_market_stats", async () => {
  const stats = await getMarketStats();
  assert(stats.activeSaleListings > 0, "expected active sale listings");
  assert(stats.campersWithActiveSaleListingsByType.length > 0, "expected camper type counts");
  return `${stats.activeSaleListings} sale, ${stats.activeRentalListings} rental listings`;
});

await check("search_marketplace_listings", async () => {
  const result = await searchMarketplaceListings({ perPage: 3 });
  assert(result.results.length > 0, "expected marketplace results");
  const first = result.results[0];
  assert(first.slug, "expected a marketplace slug");
  assert(first.url.includes("/akcesoria/"), `expected marketplace URL, got ${first.url}`);
  marketplaceSlug = first.slug;
  return `${result.totalCount} listings, first: ${first.title}`;
});

await check("get_marketplace_listing_details", async () => {
  assert(marketplaceSlug, "no marketplace slug captured from search");
  const details = await getMarketplaceListingDetails({ slug: marketplaceSlug });
  assert(details.listing.slug === marketplaceSlug, "marketplace slug mismatch");
  assert(details.listing.url.includes("/akcesoria/"), "expected marketplace URL");
  assert(details.listing.seller?.displayName, "expected seller display name");
  marketplaceSellerId = details.listing.seller?.id ?? null;
  return `${details.listing.title} (${details.listing.condition})`;
});

await check("analyze_camper_prices (cohort + comparison)", async () => {
  assert(saleSlug, "no sale slug captured from search");
  const result = await analyzeCamperPrices({ camperType: "van", slug: saleSlug });
  assert(result.priceStats.sampleSize > 0, "expected a price sample");
  assert(result.priceStats.median > 0, "expected a median price");
  assert(result.priceStats.p25 <= result.priceStats.p75, "expected ordered quartiles");
  assert(result.comparison, "expected listing comparison");
  assert(typeof result.comparison.vsMedianPercent === "number", "expected deviation from median");
  return `${result.priceStats.sampleSize} listings, median ${result.priceStats.median} PLN, listing at p${result.comparison.percentile}`;
});

await check("find_similar_campers", async () => {
  assert(saleSlug, "no sale slug captured from search");
  const result = await findSimilarCampers({ slug: saleSlug });
  assert(Array.isArray(result.results), "expected results array");
  return `${result.totalCount} similar listings`;
});

await check("get_rental_reviews", async () => {
  assert(rentalListingId, "no rental listing id captured");
  const result = await getRentalReviews({ rentalListingId });
  assert(Array.isArray(result.reviews), "expected reviews array");
  return `${result.count} reviews`;
});

await check("get_marketplace_seller", async () => {
  assert(marketplaceSellerId, "no marketplace seller id captured");
  const result = await getMarketplaceSeller({ sellerId: marketplaceSellerId });
  assert(result.seller.displayName, "expected seller display name");
  assert(Array.isArray(result.activeListings), "expected active listings");
  return `${result.seller.displayName}, ${result.activeListings.length} active listings`;
});

await check("search_wanted_ads", async () => {
  const result = await searchWantedAds({ perPage: 5 });
  assert(Array.isArray(result.results), "expected results array");
  return `${result.totalCount} wanted ads`;
});

console.log("");
console.log(`${passed} passed, ${failures} failed`);

if (failures > 0) process.exitCode = 1;
