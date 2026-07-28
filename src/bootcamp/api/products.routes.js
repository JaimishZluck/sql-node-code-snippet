/**
 * Product endpoints — filtering, sorting, pagination, search, detail.
 *
 * This file is where modules 05, 06, 10, 11, and 12 meet real HTTP. Read it
 * alongside the module READMEs: every decision here has a reason explained
 * somewhere earlier in the bootcamp.
 *
 *   GET /api/products          list with filters, sort, pagination
 *   GET /api/products/search   full-text search with relevance + facets
 *   GET /api/products/:id      one product, with its category and reviews
 */
import express from "express";
import Product from "../../models/product.model.js";
import Review from "../../models/review.model.js";
import {
  asyncHandler,
  ApiError,
  requireObjectId,
  parsePagination,
  parseSort,
  paginated,
} from "./lib/helpers.js";

const router = express.Router();

/**
 * Sort options are an ALLOW-LIST, never raw user input.
 *
 * Two reasons. Security: a client could otherwise sort by any field, forcing
 * an unindexed in-memory sort that the server may refuse above 32 MB.
 * Correctness: these keys map onto indexes that actually exist
 * (product.model.js declares { category: 1, price: -1 }).
 */
const PRODUCT_SORTS = {
  "price-asc": { price: 1 },
  "price-desc": { price: -1 },
  newest: { createdAt: -1 },
  "rating-desc": { "ratingSummary.average": -1, "ratingSummary.count": -1 },
  name: { name: 1 },
};

/**
 * Build a MongoDB filter from query parameters.
 *
 * Every value from req.query is a STRING, so numbers must be converted. Note
 * that Mongoose would cast them for us against the schema — we do it
 * explicitly anyway, because an unparseable value should become a clear 400
 * rather than a CastError from deep inside the driver.
 */
const buildProductFilter = (query) => {
  // Only active products are ever listed publicly. This is the kind of
  // default that belongs in ONE place, not repeated in every caller.
  const filter = { isActive: true };

  if (query.category) {
    filter.category = requireObjectId(query.category, "category");
  }

  // A price range becomes two operators on ONE field — an implicit AND.
  const min = query.minPrice !== undefined ? Number(query.minPrice) : undefined;
  const max = query.maxPrice !== undefined ? Number(query.maxPrice) : undefined;
  if (min !== undefined || max !== undefined) {
    if (Number.isNaN(min) || Number.isNaN(max)) {
      throw new ApiError("minPrice and maxPrice must be numbers", 400);
    }
    filter.price = {};
    if (min !== undefined) filter.price.$gte = min;
    if (max !== undefined) filter.price.$lte = max;
  }

  // ?tag=premium or ?tag=premium&tag=sale. $all requires every tag; $in would
  // require any one of them. Which you want is a product decision.
  if (query.tag) {
    const tags = Array.isArray(query.tag) ? query.tag : [query.tag];
    filter.tags = { $all: tags };
  }

  if (query.brand) filter["specs.brand"] = query.brand;

  // "in stock only" is a boolean flag in the URL, so compare to the string.
  if (query.inStock === "true") filter.stock = { $gt: 0 };

  if (query.minRating) {
    const rating = Number(query.minRating);
    if (Number.isNaN(rating)) throw new ApiError("minRating must be a number", 400);
    filter["ratingSummary.average"] = { $gte: rating };
  }

  return filter;
};

/**
 * GET /api/products
 *
 * The canonical list endpoint: filter, sort, paginate, and return metadata.
 * Try:
 *   /api/products?minPrice=1000&sort=price-desc
 *   /api/products?tag=premium&tag=wireless&inStock=true
 *   /api/products?page=3&limit=5&sort=rating-desc
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = buildProductFilter(req.query);
    const { page, limit, skip } = parsePagination(req.query);
    const sort = parseSort(req.query.sort, PRODUCT_SORTS, { createdAt: -1 });

    // The filter is used by BOTH queries, so it can never drift between the
    // page of data and its total count.
    //
    // Promise.all: these two queries are independent, so they travel down
    // separate sockets from the pool at the same time (module 15, section 10).
    const [items, total] = await Promise.all([
      Product.find(filter)
        // Only the fields a product card needs. Descriptions are up to 2,000
        // characters — sending 20 of them per page is wasted bandwidth.
        .select("name sku price discountPercent stock tags specs.brand ratingSummary category")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        // Attaching the category costs one extra query for the whole page,
        // not one per product (module 10).
        .populate("category", "name slug")
        // Read-only response: skip hydration entirely.
        .lean(),
      Product.countDocuments(filter),
    ]);

    // .lean() means virtuals are gone, so finalPrice is computed here.
    const withFinalPrice = items.map((item) => ({
      ...item,
      finalPrice: Math.round(item.price * (1 - item.discountPercent / 100)),
    }));

    res.json(paginated(withFinalPrice, { page, limit, total }));
  })
);

/**
 * GET /api/products/search?q=wireless
 *
 * Text search with relevance ranking, plus facet counts for a filter sidebar
 * — all in one round trip (module 11 and module 12).
 *
 * NOTE: this route is declared BEFORE /:id. Express matches in order, so
 * "/search" would otherwise be captured as an id.
 */
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const term = (req.query.q ?? "").trim();
    if (!term) throw new ApiError("Query parameter q is required", 400);

    const { limit } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    const [result] = await Product.aggregate([
      // $text MUST be the first stage — the text index can only be consulted
      // against the raw collection.
      { $match: { $text: { $search: term }, isActive: true } },
      // $meta exposes the relevance score the text index computed.
      { $addFields: { score: { $meta: "textScore" } } },
      {
        $facet: {
          results: [
            { $sort: { score: -1 } },
            { $limit: limit },
            {
              $project: {
                name: 1,
                sku: 1,
                price: 1,
                stock: 1,
                score: { $round: ["$score", 2] },
                finalPrice: {
                  $round: [
                    { $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] },
                    0,
                  ],
                },
              },
            },
          ],
          // Facets for the sidebar: how many matches per price band...
          priceBands: [
            {
              $bucket: {
                groupBy: "$price",
                boundaries: [0, 1000, 5000, 25000, 100000, 1000000],
                // Without `default`, one product priced above the top
                // boundary aborts the whole aggregation.
                default: "other",
                output: { count: { $sum: 1 } },
              },
            },
          ],
          // ...and per brand.
          brands: [{ $sortByCount: "$specs.brand" }, { $limit: 5 }],
          total: [{ $count: "matches" }],
        },
      },
    ]);

    res.json({
      query: term,
      // Every facet's output is an ARRAY, so the scalar ones need [0].
      total: result.total[0]?.matches ?? 0,
      data: result.results,
      facets: { priceBands: result.priceBands, brands: result.brands },
    });
  })
);

/**
 * GET /api/products/:id
 *
 * A detail page: the product, its category, and its most helpful reviews.
 */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    // Validate before querying, so a malformed id is a 400 and not a 500.
    const id = requireObjectId(req.params.id, "product id");

    const [product, reviews] = await Promise.all([
      Product.findById(id)
        .populate("category", "name slug")
        // .orFail() throws DocumentNotFoundError, which the error middleware
        // turns into a 404 — so no `if (!product)` is needed here.
        .orFail()
        .lean(),
      Review.find({ product: id })
        .sort({ helpfulVotes: -1, createdAt: -1 })
        .limit(5)
        .select("rating title comment helpfulVotes createdAt")
        .populate("user", "name")
        .lean(),
    ]);

    res.json({
      data: {
        ...product,
        finalPrice: Math.round(product.price * (1 - product.discountPercent / 100)),
        // ratingSummary is DENORMALIZED onto the product (module 09), so the
        // detail page needs no aggregation over reviews at all.
        topReviews: reviews,
      },
    });
  })
);

export default router;
