// Response shaping for tool output.
//
// The public API already returns decoded enums (`diesel`, `automatic`, `van`)
// and absolute photo URLs, so these helpers mostly trim payloads the model
// does not need, add human-facing site links, and keep search rows compact.

import { siteUrl } from "./api-client.js";

const CAMPER_SPEC_KEYS = [
  "id", "model", "year", "vin", "sleepingPlaces", "seats", "approvedSeats", "power", "mileage",
  "plateNumber", "dmcKg", "unladenWeightKg", "fuelType", "camperType", "state", "transmission",
  "length", "width", "height", "hasKitchen", "hasBathroom", "hasGas", "hasMarkiza",
  "hasFullServiceHistory", "isDamaged", "isForDisabled", "isImported", "isOffroad",
  "isPetFriendly", "isWinterReady", "numberOfOwners", "drive", "emissionClass", "color",
  "engineCapacity", "fuelTankCapacity", "cylinders", "airConditioning", "bedTypes",
  "cruiseControls", "heatings", "seatingArrangements", "toiletType", "showerType",
  "kitchenType", "trailerCoupling",
];

export function truncate(value, maxChars) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}…`, truncated: true };
}

/** Compact camper row used inside search results. */
export function camperCard(camper = {}) {
  return {
    id: camper.id ?? null,
    make: camper.make?.name ?? null,
    model: camper.model ?? null,
    year: camper.year ?? null,
    mileage: camper.mileage ?? null,
    fuelType: camper.fuelType ?? null,
    transmission: camper.transmission ?? null,
    camperType: camper.camperType ?? null,
    state: camper.state ?? null,
    power: camper.power ?? null,
    sleepingPlaces: camper.sleepingPlaces ?? null,
    seats: camper.seats ?? null,
    primaryPhoto: camper.photos?.[0]?.url ?? null,
  };
}

/** Full camper spec sheet, including photos and equipment when present. */
export function camperDetail(camper = {}) {
  const spec = {};
  for (const key of CAMPER_SPEC_KEYS) {
    spec[key] = camper[key] ?? null;
  }

  return {
    ...spec,
    make: camper.make ?? null,
    originCountry: camper.originCountry ?? null,
    photos: (camper.photos ?? []).map((photo) => ({
      id: photo.id,
      position: photo.position,
      url: photo.url,
      legacyJpegUrl: photo.email_url ?? null,
    })),
    equipments: (camper.equipments ?? []).map((equipment) => ({
      name: equipment.name ?? null,
      category: equipment.categoryName ?? equipment.category ?? null,
    })),
  };
}

export function saleListingCard(node = {}) {
  return {
    listingId: node.id,
    slug: node.slug,
    title: node.title,
    price: node.price ?? null,
    currency: node.currency ?? null,
    isNegotiable: node.isNegotiable ?? null,
    city: node.city?.name ?? null,
    region: node.city?.region?.name ?? null,
    publishedAt: node.createdAt ?? null,
    url: siteUrl(`/ogloszenie/${node.slug}`),
    camper: camperCard(node.camper),
  };
}

export function saleListingDetail(listing = {}, { maxDescriptionChars } = {}) {
  const description = truncate(listing.description, maxDescriptionChars);

  return {
    segment: "sale",
    listingId: listing.id,
    slug: listing.slug,
    title: listing.title,
    status: listing.status,
    price: listing.price ?? null,
    currency: listing.currency,
    isNegotiable: listing.isNegotiable,
    priceWithVat: listing.priceWithVat,
    invoiceAvailable: listing.invoiceAvailable,
    startDate: listing.startDate,
    endDate: listing.endDate,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    url: siteUrl(`/ogloszenie/${listing.slug}`),
    location: {
      city: listing.city?.name ?? null,
      region: listing.city?.region?.name ?? null,
      county: listing.city?.county?.name ?? null,
      zipCode: listing.zipCode?.code ?? null,
      latitude: listing.city?.latitude ?? null,
      longitude: listing.city?.longitude ?? null,
    },
    contact: {
      name: listing.contactName ?? listing.externalSellerName ?? null,
      phone: listing.contactPhone ?? listing.externalSellerPhone ?? null,
      email: listing.externalSellerEmail ?? null,
      sellerAccountStatus: listing.sellerAccountStatus ?? null,
    },
    description: description.text,
    descriptionTruncated: description.truncated,
    camper: camperDetail(listing.camper),
  };
}

export function rentalListingCard(node = {}) {
  return {
    listingId: node.id,
    slug: node.slug,
    title: node.title,
    currency: node.currency ?? null,
    dailyRates: rentalRates(node.rentalPrices),
    minRentalDays: node.minRentalDays ?? null,
    maxRentalDays: node.maxRentalDays ?? null,
    instantBook: node.instantBook ?? null,
    kmIncludedPerDay: node.kmIncludedPerDay ?? null,
    city: node.city?.name ?? null,
    region: node.city?.region?.name ?? null,
    url: siteUrl(`/wynajem/${node.slug}`),
    camper: camperCard(node.camper),
  };
}

export function rentalListingDetail(listing = {}, { maxDescriptionChars } = {}) {
  const description = truncate(listing.description, maxDescriptionChars);

  return {
    segment: "rental",
    listingId: listing.id,
    slug: listing.slug,
    title: listing.title,
    status: listing.status,
    currency: listing.currency,
    priceType: listing.priceType,
    isNegotiable: listing.isNegotiable,
    minRentalDays: listing.minRentalDays,
    maxRentalDays: listing.maxRentalDays,
    instantBook: listing.instantBook,
    cancellationPolicy: listing.cancellationPolicy,
    kmIncludedPerDay: listing.kmIncludedPerDay,
    extraKmPrice: listing.extraKmPriceCents != null ? listing.extraKmPriceCents / 100 : null,
    dailyRates: rentalRates(listing.rentalPrices),
    additionalFees: (listing.rentalAdditionalFees ?? []).map((fee) => ({
      name: fee.name ?? null,
      feeType: fee.feeType ?? null,
      billingType: fee.billingType ?? null,
      amount: fee.priceCents != null ? fee.priceCents / 100 : null,
      currency: fee.currency ?? "PLN",
    })),
    unavailableRanges: (listing.unavailableRanges ?? []).slice(0, 20),
    pickupInstructions: listing.pickupInstructions ?? null,
    startDate: listing.startDate,
    endDate: listing.endDate,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    url: siteUrl(`/wynajem/${listing.slug}`),
    location: {
      city: listing.city?.name ?? null,
      region: listing.city?.region?.name ?? null,
      zipCode: listing.zipCode?.code ?? null,
      latitude: listing.city?.latitude ?? null,
      longitude: listing.city?.longitude ?? null,
    },
    contact: {
      name: listing.contactName ?? null,
      phone: listing.contactPhone ?? null,
    },
    description: description.text,
    descriptionTruncated: description.truncated,
    camper: camperDetail(listing.camper),
  };
}

export function marketplaceListingCard(node = {}) {
  return {
    listingId: node.id,
    slug: node.slug,
    title: node.title,
    price: node.price ?? null,
    currency: node.currency ?? null,
    condition: node.condition ?? null,
    category: node.categoryName ?? node.category ?? null,
    subcategory: node.subcategoryName ?? node.subcategory ?? null,
    brand: node.brand ?? null,
    manufacturer: node.manufacturer ?? null,
    soldOut: node.soldOut ?? null,
    city: node.city?.name ?? null,
    seller: node.seller?.displayName ?? null,
    primaryPhoto: node.photoUrls?.[0] ?? node.photos?.[0]?.url ?? null,
    publishedAt: node.publishedAt ?? null,
    url: siteUrl(`/akcesoria/${node.slug}`),
  };
}

export function marketplaceListingDetail(listing = {}, { maxDescriptionChars } = {}) {
  const description = truncate(listing.description, maxDescriptionChars);

  return {
    listingId: listing.id,
    slug: listing.slug,
    title: listing.title,
    status: listing.status,
    condition: listing.condition,
    conditionNotes: listing.conditionNotes ?? null,
    price: listing.price ?? null,
    currency: listing.currency ?? null,
    isNegotiable: listing.isNegotiable ?? null,
    quantity: listing.quantity ?? null,
    soldOut: listing.soldOut ?? null,
    category: listing.categoryName ?? listing.category ?? null,
    subcategory: listing.subcategoryName ?? listing.subcategory ?? null,
    brand: listing.brand ?? null,
    manufacturer: listing.manufacturer ?? null,
    partNumber: listing.partNumber ?? null,
    camperModel: listing.camperModel ?? null,
    compatibilityTags: listing.compatibilityTags ?? [],
    includedItems: listing.includedItems ?? null,
    isBundle: listing.isBundle ?? null,
    dimensions: listing.dimensions ?? null,
    weightKg: listing.weightKg ?? null,
    shipping: {
      deliveryMethods: listing.deliveryMethods ?? [],
      shippingPrice: listing.shippingPriceCents != null ? listing.shippingPriceCents / 100 : null,
      localDeliveryPrice: listing.localDeliveryPriceCents != null ? listing.localDeliveryPriceCents / 100 : null,
      shippingCurrency: listing.shippingCurrency ?? null,
      courierName: listing.courierName ?? null,
      shippingTime: listing.shippingTime ?? null,
      parcelSize: listing.parcelSize ?? null,
      pickupDetails: listing.pickupDetails ?? null,
      pickupHours: listing.pickupHours ?? null,
    },
    location: {
      city: listing.city?.name ?? null,
      latitude: listing.city?.latitude ?? null,
      longitude: listing.city?.longitude ?? null,
      zipCode: listing.zipCode?.code ?? null,
    },
    contact: {
      name: listing.contactName ?? null,
      phone: listing.contactPhone ?? null,
    },
    seller: listing.seller ?? null,
    photos: listing.photoUrls ?? (listing.photos ?? []).map((photo) => photo.url),
    description: description.text,
    descriptionTruncated: description.truncated,
    publishedAt: listing.publishedAt ?? null,
    expiresAt: listing.expiresAt ?? null,
    url: siteUrl(`/akcesoria/${listing.slug}`),
  };
}

/** Normalizes `rentalPrices` into per-period PLN amounts, base rate first. */
export function rentalRates(prices = []) {
  return [...prices]
    .sort((left, right) => Number(right.isBaseRate) - Number(left.isBaseRate))
    .map((price) => ({
      period: price.periodType ?? null,
      price: price.priceCents != null ? price.priceCents / 100 : null,
      currency: price.currency ?? "PLN",
      isBaseRate: price.isBaseRate ?? false,
      season: price.seasonName ?? null,
      seasonStart: price.seasonStart ?? null,
      seasonEnd: price.seasonEnd ?? null,
    }));
}
