/**
 * Dashboard endpoints — aggregation behind HTTP.
 *
 * These are the reports from module 11, wired to routes. The whole point is
 * that each endpoint is ONE round trip: the server computes, Node.js only
 * serializes.
 *
 *   GET /api/dashboard/summary        headline numbers + trends ($facet)
 *   GET /api/dashboard/top-products   best sellers ($unwind + $group)
 *   GET /api/dashboard/customers      top customers ($lookup)
 */
import express from "express";
import Order from "../../models/order.model.js";
import Product from "../../models/product.model.js";
import Review from "../../models/review.model.js";
import { asyncHandler, parsePagination } from "./lib/helpers.js";

const router = express.Router();

// Only these statuses represent money actually earned. Defining it once
// stops two endpoints from quietly disagreeing about what "revenue" means.
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];

/**
 * GET /api/dashboard/summary
 *
 * Five independent reports from ONE query, using $facet. Doing this with five
 * separate requests would mean five round trips and five passes over the same
 * documents; here the leading $match is evaluated once and shared.
 */
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const [summary] = await Order.aggregate([
      // This $match applies to every facet below, and can use the { status: 1 }
      // index because it is the first stage (module 12).
      { $match: { status: { $in: REVENUE_STATUSES } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                revenue: { $sum: "$totalAmount" },
                orders: { $sum: 1 },
                averageOrderValue: { $avg: "$totalAmount" },
              },
            },
            {
              $project: {
                _id: 0,
                revenue: 1,
                orders: 1,
                averageOrderValue: { $round: ["$averageOrderValue", 0] },
              },
            },
          ],
          monthlyTrend: [
            // $dateTrunc gives one clean date field to group by, instead of a
            // compound { year, month } key you have to reassemble.
            { $group: { _id: { $dateTrunc: { date: "$placedAt", unit: "month" } }, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, month: { $dateToString: { format: "%Y-%m", date: "$_id" } }, revenue: 1, orders: 1 } },
          ],
          byPaymentMethod: [{ $sortByCount: "$payment.method" }],
          byStatus: [
            { $group: { _id: "$status", orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
            { $sort: { revenue: -1 } },
          ],
          largestOrders: [
            { $sort: { totalAmount: -1 } },
            { $limit: 5 },
            { $project: { _id: 0, orderNumber: 1, totalAmount: 1, placedAt: 1 } },
          ],
        },
      },
    ]);

    // Every facet returns an ARRAY, so scalar summaries need [0].
    res.json({
      data: {
        totals: summary.totals[0] ?? { revenue: 0, orders: 0, averageOrderValue: 0 },
        monthlyTrend: summary.monthlyTrend,
        byPaymentMethod: summary.byPaymentMethod,
        byStatus: summary.byStatus,
        largestOrders: summary.largestOrders,
      },
    });
  })
);

/**
 * GET /api/dashboard/top-products?limit=10
 *
 * Line items live INSIDE orders, so answering "which product sold most?"
 * requires flattening the arrays first (module 11, lesson 03).
 */
router.get(
  "/top-products",
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    const rows = await Order.aggregate([
      // Filter BEFORE $unwind — never expand documents you are about to drop.
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          // Only ELEMENT fields are summed here. Summing $totalAmount after
          // an $unwind would count each order once per line item.
          unitsSold: { $sum: "$items.quantity" },
          revenue: { $sum: "$items.subtotal" },
          orderCount: { $sum: 1 },
          productName: { $first: "$items.productName" },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: limit },
      // Join to the live catalogue for current stock and rating.
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          productName: 1,
          unitsSold: 1,
          revenue: 1,
          orderCount: 1,
          // $arrayElemAt rather than $unwind: cheaper, and it cannot
          // accidentally drop rows whose product was deleted.
          currentStock: { $arrayElemAt: ["$product.stock", 0] },
          rating: { $arrayElemAt: ["$product.ratingSummary.average", 0] },
        },
      },
    ]);

    res.json({ data: rows });
  })
);

/**
 * GET /api/dashboard/customers?city=Mumbai
 *
 * Filtering orders by a property of the JOINED user — the thing populate()
 * fundamentally cannot do (module 11, lesson 04).
 */
router.get(
  "/customers",
  asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    const pipeline = [
      { $match: { status: { $in: REVENUE_STATUSES } } },
      { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "customer" } },
      // preserveNullAndEmptyArrays would keep orders whose user was deleted;
      // for a customer report we deliberately want only real customers.
      { $unwind: "$customer" },
    ];

    // The join makes this filter possible at all.
    if (req.query.city) {
      pipeline.push({ $match: { "customer.address.city": req.query.city } });
    }

    pipeline.push(
      {
        $group: {
          _id: "$customer._id",
          name: { $first: "$customer.name" },
          email: { $first: "$customer.email" },
          city: { $first: "$customer.address.city" },
          lifetimeSpend: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: "$totalAmount" },
          lastOrderAt: { $max: "$placedAt" },
        },
      },
      { $sort: { lifetimeSpend: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          name: 1,
          email: 1,
          city: 1,
          orders: 1,
          lifetimeSpend: 1,
          averageOrderValue: { $round: ["$averageOrderValue", 0] },
          lastOrderAt: 1,
        },
      }
    );

    res.json({ data: await Order.aggregate(pipeline) });
  })
);

/**
 * GET /api/dashboard/catalogue
 *
 * Inventory health: stock bands, category breakdown, and rating distribution.
 */
router.get(
  "/catalogue",
  asyncHandler(async (req, res) => {
    const [catalogue, ratings] = await Promise.all([
      Product.aggregate([
        { $match: { isActive: true } },
        {
          $facet: {
            stockBands: [
              {
                $bucket: {
                  groupBy: "$stock",
                  boundaries: [0, 1, 10, 50, 200, 100000],
                  default: "other", // never omit this — see module 11
                  output: { products: { $sum: 1 }, value: { $sum: { $multiply: ["$price", "$stock"] } } },
                },
              },
            ],
            byCategory: [
              { $group: { _id: "$category", products: { $sum: 1 }, avgPrice: { $avg: "$price" } } },
              { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
              {
                $project: {
                  _id: 0,
                  category: { $arrayElemAt: ["$cat.name", 0] },
                  products: 1,
                  avgPrice: { $round: ["$avgPrice", 0] },
                },
              },
              { $sort: { products: -1 } },
            ],
            outOfStock: [{ $match: { stock: 0 } }, { $count: "count" }],
          },
        },
      ]),
      Review.aggregate([
        { $group: { _id: "$rating", reviews: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $project: { _id: 0, rating: "$_id", reviews: 1 } },
      ]),
    ]);

    res.json({
      data: {
        stockBands: catalogue[0].stockBands,
        byCategory: catalogue[0].byCategory,
        outOfStock: catalogue[0].outOfStock[0]?.count ?? 0,
        ratingDistribution: ratings,
      },
    });
  })
);

export default router;
