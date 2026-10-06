// Camper tools: sale listings, rentals, makes, equipment and market stats.
//
// All data comes from the public API (`/public/...`) which already applies
// public visibility rules (active, not deleted, paid window running) and
// decodes enum columns into readable strings.

import { apiGet, siteUrl } from "./api-client.js";
import {
  camperDetail,
  rentalListingCard,
  rentalListingDetail,
  saleListingCard,
  saleListingDetail,
} from "./formatters.js";

const SEARCH_TTL_MS = 2 * 60 * 1000;
const DETAIL_TTL_MS = 2 * 60 * 1000;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const LOOKUP_TTL_MS = 60 * 60 * 1000;

export const CAMPER_TYPES = ["van", "integra", "half_integra", "alcove", "pickup", "trailer", "rooftop", "other"];
export const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "lpg", "other"];
export const TRANSMISSIONS = ["manual", "automatic", "semi_automatic"];
export const CAMPER_STATES = ["brand_new", "pre_owned"];
export const SALE_SORTS = ["newest", "oldest", "price_asc", "price_desc", "ranking", "year_desc", "year_asc"];
export const RENTAL_SORTS = ["newest", "price_asc", "price_desc"];

const RENTAL_SORT_PARAMS = {
  newest: "newest",
  price_asc: "PRICE_ASC",
  price_desc: "PRICE_DESC",
};

export async function searchCampers({
  segment = "sale",
  query,
  make,
  model,
  camperType,
  fuelType,
  transmission,
  state,
  priceMin,
  priceMax,
  yearMin,
  yearMax,
  mileageMax,
  sleepingPlacesMin,
  city,
  availableFrom,
  availableTo,
  sort,
  limit = 10,
  after,
} = {}) {
  if (segment !== "sale" && segment !== "rental") {
    throw new Error('segment must be "sale" or "rental".');
  }

  const cityRecord = city ? await resolveCity(city) : null;

  const shared = {
    first: limit,
    after,
    terms: query,
    makes: make ? [make] : undefined,
    model,
    camper_type: camperType,
    fuel_type: fuelType ? [fuelType] : undefined,
    transmissions: transmission ? [transmission] : undefined,
    states: state ? [state] : undefined,
    year_from: yearMin,
    year_to: yearMax,
    mileage_to: mileageMax,
    sleeping_places_from: sleepingPlacesMin,
    city_id: cityRecord?.id,
  };

  if (segment === "sale") {
    const data = await apiGet("/public/search", {
      params: {
        ...shared,
        min_price: priceMin,
        max_price: priceMax,
        sort,
      },
      ttlMs: SEARCH_TTL_MS,
    });

    return {
      segment: "sale",
      totalCount: data.totalCount ?? 0,
      returned: (data.nodes ?? []).length,
      hasNextPage: data.pageInfo?.hasNextPage ?? false,
      nextCursor: data.pageInfo?.endCursor ?? null,
      appliedFilters: appliedFilters({ query, make, model, camperType, fuelType, transmission, state, priceMin, priceMax, yearMin, yearMax, mileageMax, sleepingPlacesMin, cityRecord, sort }),
      results: (data.nodes ?? []).map(saleListingCard),
    };
  }

  const data = await apiGet("/public/rental-listings", {
    params: {
      ...shared,
      min_rental_price_cents: priceMin != null ? Math.round(priceMin * 100) : undefined,
      max_rental_price_cents: priceMax != null ? Math.round(priceMax * 100) : undefined,
      available_from: availableFrom,
      available_to: availableTo,
      sort: RENTAL_SORT_PARAMS[sort],
    },
    ttlMs: SEARCH_TTL_MS,
  });

  return {
    segment: "rental",
    totalCount: data.totalCount ?? 0,
    returned: (data.nodes ?? []).length,
    hasNextPage: data.pageInfo?.hasNextPage ?? false,
    nextCursor: data.pageInfo?.endCursor ?? null,
    appliedFilters: appliedFilters({ query, make, model, camperType, fuelType, transmission, state, priceMin, priceMax, yearMin, yearMax, mileageMax, sleepingPlacesMin, cityRecord, sort, availableFrom, availableTo, priceUnit: "PLN per rental period" }),
    results: (data.nodes ?? []).map(rentalListingCard),
  };
}

export async function getCamperDetails({
  slug,
  camperId,
  segment = "auto",
  includeDescription = true,
  maxDescriptionChars = 4000,
} = {}) {
  if (!slug && !camperId) throw new Error("Provide either slug or camper_id.");
  if (slug && camperId) throw new Error("Provide only one of slug or camper_id.");

  if (camperId) return camperCatalogDetails(camperId);

  const descriptionOptions = { maxDescriptionChars: includeDescription ? maxDescriptionChars : 0 };

  if (segment !== "rental") {
    const sale = await tryGet("/public/listing", { slug });
    if (sale) return saleListingDetail(sale.listing, descriptionOptions);
    if (segment === "sale") throw notFound("sale listing", slug);
  }

  if (segment !== "sale") {
    const rental = await tryGet("/public/rental-listing", { slug });
    if (rental) return rentalListingDetail(rental.rentalListing, descriptionOptions);
    if (segment === "rental") throw notFound("rental listing", slug);
  }

  throw notFound("sale or rental listing", slug);
}

async function camperCatalogDetails(camperId) {
  const data = await apiGet("/public/campers", { ttlMs: CATALOG_TTL_MS });
  const camper = (data.campers ?? []).find((item) => item.id === camperId);
  if (!camper) throw new Error(`No camper found with id "${camperId}".`);

  return {
    segment: "camper",
    source: "catalog",
    note: "Specs come from the full camper catalog and may belong to a camper without an active listing.",
    url: null,
    camper: camperDetail(camper),
  };
}

export async function listMakes({ query, limit = 250 } = {}) {
  const data = await apiGet("/public/makes", { ttlMs: LOOKUP_TTL_MS });
  const normalizedQuery = query ? normalizeText(query) : null;

  const makes = (data.makes ?? [])
    .filter((make) => !normalizedQuery || normalizeText(make.name).includes(normalizedQuery))
    .slice(0, limit)
    .map((make) => ({
      id: make.id,
      name: make.name,
      saleListingsCount: make.listingsCount ?? 0,
      rentalListingsCount: make.rentalListingsCount ?? 0,
    }));

  return { count: makes.length, makes };
}

export async function listEquipment() {
  const data = await apiGet("/public/equipments", { ttlMs: LOOKUP_TTL_MS });
  return {
    count: (data.equipments ?? []).length,
    categories: (data.equipments ?? []).map((category) => ({
      key: category.key,
      name: category.name,
      equipments: (category.equipments ?? []).map((equipment) => equipment.name),
    })),
  };
}

export async function getMarketStats() {
  const [saleCount, rentals, camperTypes, makes] = await Promise.all([
    apiGet("/public/search-count", { ttlMs: SEARCH_TTL_MS }),
    apiGet("/public/rental-listings", { params: { first: 1 }, ttlMs: SEARCH_TTL_MS }),
    apiGet("/public/camper-type-stats", { ttlMs: SEARCH_TTL_MS }),
    apiGet("/public/makes", { ttlMs: LOOKUP_TTL_MS }),
  ]);

  const makesWithListings = (makes.makes ?? [])
    .filter((make) => (make.listingsCount ?? 0) > 0 || (make.rentalListingsCount ?? 0) > 0)
    .sort((left, right) => (right.listingsCount ?? 0) - (left.listingsCount ?? 0))
    .map((make) => ({
      name: make.name,
      saleListingsCount: make.listingsCount ?? 0,
      rentalListingsCount: make.rentalListingsCount ?? 0,
    }));

  return {
    activeSaleListings: saleCount.count ?? 0,
    activeRentalListings: rentals.totalCount ?? 0,
    campersWithActiveSaleListingsByType: (camperTypes.camperTypeStats ?? []).map((stat) => ({
      camperType: stat.camperType,
      count: stat.count,
    })),
    makesWithActiveListings: makesWithListings,
    siteUrl: siteUrl("/ogloszenie"),
  };
}

export async function analyzeCamperPrices({
  make,
  model,
  camperType,
  fuelType,
  transmission,
  state,
  yearMin,
  yearMax,
  mileageMax,
  city,
  slug,
  maxSample = 200,
} = {}) {
  const cityRecord = city ? await resolveCity(city) : null;
  const filters = {
    makes: make ? [make] : undefined,
    model,
    camper_type: camperType,
    fuel_type: fuelType ? [fuelType] : undefined,
    transmissions: transmission ? [transmission] : undefined,
    states: state ? [state] : undefined,
    year_from: yearMin,
    year_to: yearMax,
    mileage_to: mileageMax,
    city_id: cityRecord?.id,
  };

  const { totalCount, rows } = await fetchSaleListings(filters, maxSample);
  const pricedRows = rows.filter((row) => Number.isFinite(row.price) && row.price > 0);
  if (pricedRows.length === 0) {
    throw new Error("No priced sale listings matched this cohort. Broaden the filters and try again.");
  }

  const prices = pricedRows.map((row) => row.price).sort((left, right) => left - right);
  const median = percentile(prices, 50);
  const stats = {
    sampleSize: prices.length,
    matchedListings: totalCount,
    sampledAll: prices.length >= totalCount,
    currency: pricedRows[0]?.currency ?? "PLN",
    min: prices[0],
    max: prices[prices.length - 1],
    average: round(average(prices)),
    median: round(median),
    p25: round(percentile(prices, 25)),
    p75: round(percentile(prices, 75)),
  };

  let comparison = null;
  if (slug) {
    const data = await tryGet("/public/listing", { slug });
    if (!data?.listing) throw notFound("sale listing", slug);

    const price = data.listing.price;
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Listing "${slug}" has no price to compare against the cohort.`);
    }

    const cheaperThanCount = prices.filter((value) => value < price).length;
    comparison = {
      slug: data.listing.slug,
      title: data.listing.title,
      price,
      currency: data.listing.currency,
      cheaperThanCount,
      percentile: round(((cheaperThanCount + 0.5) / prices.length) * 100, 1),
      vsMedianPercent: round(((price - median) / median) * 100, 1),
      url: siteUrl(`/ogloszenie/${data.listing.slug}`),
    };
  }

  return {
    cohort: appliedFilters({ make, model, camperType, fuelType, transmission, state, yearMin, yearMax, mileageMax, cityRecord }),
    priceStats: stats,
    averagePriceByYear: buildYearStats(pricedRows),
    comparison,
  };
}

export async function findSimilarCampers({ slug, limit = 6 } = {}) {
  if (!slug) throw new Error("slug is required.");

  const data = await tryGet("/public/listing", { slug });
  if (!data?.listing) throw notFound("sale listing", slug);

  const similar = data.listing.similarListings ?? [];
  return {
    slug,
    totalCount: similar.length,
    returned: Math.min(similar.length, limit),
    results: similar.slice(0, limit).map(saleListingCard),
  };
}

export async function getRentalReviews({ rentalListingId, limit = 20 } = {}) {
  if (!rentalListingId) throw new Error("rentalListingId is required.");

  const data = await apiGet("/public/listing-reviews", {
    params: { rental_listing_id: rentalListingId },
    ttlMs: SEARCH_TTL_MS,
  });

  const reviews = data.listingReviews ?? [];
  return {
    rentalListingId,
    count: reviews.length,
    reviews: reviews.slice(0, limit).map((review) => ({
      id: review.id,
      rating: review.rating,
      content: review.content,
      reviewType: review.reviewType,
      createdAt: review.createdAt,
      reviewer: review.reviewer?.id ?? null,
      reviewee: review.reviewee?.id ?? null,
    })),
  };
}

async function fetchSaleListings(filters, maxRows) {
  const rows = [];
  let after;
  let totalCount = 0;

  while (rows.length < maxRows) {
    const data = await apiGet("/public/search", {
      params: { ...filters, first: 100, after },
      ttlMs: SEARCH_TTL_MS,
    });

    totalCount = data.totalCount ?? totalCount;
    rows.push(...(data.nodes ?? []));

    if (!data.pageInfo?.hasNextPage || !data.pageInfo.endCursor) break;
    after = data.pageInfo.endCursor;
  }

  return { totalCount, rows: rows.slice(0, maxRows) };
}

function buildYearStats(rows) {
  const groups = new Map();
  for (const row of rows) {
    const year = row.camper?.year;
    if (!Number.isFinite(year)) continue;

    const entry = groups.get(year) ?? { year, count: 0, total: 0 };
    entry.count += 1;
    entry.total += row.price;
    groups.set(year, entry);
  }

  return [...groups.values()]
    .map((entry) => ({ year: entry.year, count: entry.count, averagePrice: round(entry.total / entry.count) }))
    .sort((left, right) => right.year - left.year);
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];

  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function resolveCity(name) {
  const data = await apiGet("/public/locations/cities", {
    params: { name, first: 5 },
    ttlMs: LOOKUP_TTL_MS,
  });

  const cities = data.nodes ?? [];
  if (cities.length === 0) {
    throw new Error(`No Polish city found matching "${name}".`);
  }

  const normalizedName = normalizeText(name);
  const exact = cities.find((city) => normalizeText(city.name) === normalizedName);
  const city = exact ?? cities[0];

  return {
    id: city.id,
    name: city.name,
    region: city.region?.name ?? null,
    matchedExactly: Boolean(exact),
  };
}

function appliedFilters({ query, make, model, camperType, fuelType, transmission, state, priceMin, priceMax, yearMin, yearMax, mileageMax, sleepingPlacesMin, cityRecord, sort, availableFrom, availableTo, priceUnit }) {
  const filters = {};
  if (query) filters.query = query;
  if (make) filters.make = make;
  if (model) filters.model = model;
  if (camperType) filters.camperType = camperType;
  if (fuelType) filters.fuelType = fuelType;
  if (transmission) filters.transmission = transmission;
  if (state) filters.state = state;
  if (priceMin != null) filters.priceMin = priceMin;
  if (priceMax != null) filters.priceMax = priceMax;
  if (priceUnit) filters.priceUnit = priceUnit;
  if (yearMin != null) filters.yearMin = yearMin;
  if (yearMax != null) filters.yearMax = yearMax;
  if (mileageMax != null) filters.mileageMax = mileageMax;
  if (sleepingPlacesMin != null) filters.sleepingPlacesMin = sleepingPlacesMin;
  if (availableFrom) filters.availableFrom = availableFrom;
  if (availableTo) filters.availableTo = availableTo;
  if (cityRecord) filters.city = { name: cityRecord.name, region: cityRecord.region, matchedExactly: cityRecord.matchedExactly };
  if (sort) filters.sort = sort;
  return filters;
}

async function tryGet(path, params) {
  try {
    return await apiGet(path, { params, ttlMs: DETAIL_TTL_MS });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function notFound(kind, slug) {
  return new Error(`No active ${kind} found with slug "${slug}".`);
}

function normalizeText(value) {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
