// Marketplace (akcesoria) tools: accessory listings bought and sold by users.

import { apiGet } from "./api-client.js";
import { marketplaceListingCard, marketplaceListingDetail } from "./formatters.js";

const SEARCH_TTL_MS = 2 * 60 * 1000;
const DETAIL_TTL_MS = 2 * 60 * 1000;

export const MARKETPLACE_CONDITIONS = ["new_item", "used", "refurbished", "damaged"];

export async function searchMarketplaceListings({
  query,
  manufacturer,
  category,
  subcategory,
  condition,
  compatibility,
  priceMin,
  priceMax,
  location,
  page = 1,
  perPage = 20,
} = {}) {
  const data = await apiGet("/public/marketplace-listings", {
    params: {
      q: query,
      manufacturer,
      category,
      subcategory,
      condition,
      compatibility,
      min_price: priceMin,
      max_price: priceMax,
      location,
      page,
      per_page: perPage,
    },
    ttlMs: SEARCH_TTL_MS,
  });

  const meta = data.meta ?? {};

  return {
    totalCount: meta.totalCount ?? (data.marketplaceListings ?? []).length,
    page: meta.page ?? page,
    perPage: meta.perPage ?? perPage,
    totalPages: meta.totalPages ?? null,
    facets: meta.facets ?? null,
    results: (data.marketplaceListings ?? []).map(marketplaceListingCard),
  };
}

export async function getMarketplaceListingDetails({
  slug,
  includeRelated = true,
  maxDescriptionChars = 4000,
} = {}) {
  if (!slug) throw new Error("slug is required.");

  const data = await apiGet(`/public/marketplace-listings/${encodeURIComponent(slug)}`, {
    ttlMs: DETAIL_TTL_MS,
  });

  return {
    listing: marketplaceListingDetail(data.marketplaceListing, { maxDescriptionChars }),
    relatedListings: includeRelated
      ? (data.relatedMarketplaceListings ?? []).slice(0, 6).map(marketplaceListingCard)
      : [],
    sellerOtherListings: (data.sellerMarketplaceListings ?? []).slice(0, 6).map(marketplaceListingCard),
  };
}
