import { randomInt, pick, pickMany, chance, dateWithinDays } from "../lib/random.js";

// Weighted status pool — real shops have mostly completed orders.
const STATUS_POOL = [
  "delivered", "delivered", "delivered", "delivered", "delivered",
  "shipped", "shipped",
  "paid", "paid",
  "pending",
  "cancelled",
];

const PAYMENT_METHODS = ["card", "upi", "netbanking", "cod"];

/**
 * Build order objects from already-inserted users and products.
 *
 * Realistic details that lessons rely on:
 *  - `items[].productName` / `unitPrice` are SNAPSHOTS of the product at
 *    purchase time (denormalization) — unitPrice applies the discount
 *  - `placedAt` is spread over the last 365 days -> date grouping works
 *  - totals are consistent: subtotal = unitPrice * quantity, totalAmount
 *    = sum of subtotals -> aggregation math is verifiable
 */
export function buildOrders(random, users, products, count = 300) {
  const orders = [];
  const customers = users.filter((user) => !user.deletedAt);

  for (let i = 0; i < count; i += 1) {
    const user = pick(random, customers);
    const lineProducts = pickMany(random, products, randomInt(random, 1, 4));

    const items = lineProducts.map((product) => {
      const quantity = randomInt(random, 1, 3);
      // Snapshot of the effective price when the order was placed.
      const unitPrice = Math.round(product.price * (1 - product.discountPercent / 100));
      return {
        product: product._id,
        productName: product.name,
        unitPrice,
        quantity,
        subtotal: unitPrice * quantity,
      };
    });

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const status = pick(random, STATUS_POOL);
    const placedAt = dateWithinDays(random, 365);
    const paymentMethod = pick(random, PAYMENT_METHODS);

    orders.push({
      orderNumber: `ORD-${100001 + i}`,
      user: user._id,
      items,
      status,
      payment: {
        method: paymentMethod,
        // Cash-on-delivery is paid only once delivered; everything else is
        // paid unless the order is still pending or was cancelled.
        paidAt:
          status === "pending" || status === "cancelled" || (paymentMethod === "cod" && status !== "delivered")
            ? null
            : placedAt,
      },
      // Ship to the user's saved address when they have one, otherwise a
      // generic pickup point — some orders having no street is fine.
      shippingAddress: user.address ?? { city: "Mumbai", state: "Maharashtra", country: "India", zip: "400001" },
      totalAmount,
      placedAt,
      ...(chance(random, 0.15) ? { notes: pick(random, ["Gift wrap please", "Leave at door", "Call before delivery"]) } : {}),
    });
  }

  return orders;
}
