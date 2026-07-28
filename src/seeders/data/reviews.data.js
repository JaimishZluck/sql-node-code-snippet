import { randomInt, pick, chance, dateWithinDays } from "../lib/random.js";

// Rating pool weighted toward the positive end, like real product reviews.
const RATING_POOL = [5, 5, 5, 4, 4, 4, 4, 3, 3, 2, 1];

const TITLES = {
  5: ["Absolutely love it", "Exceeded expectations", "Perfect purchase"],
  4: ["Very good overall", "Happy with it", "Solid value"],
  3: ["Decent, not amazing", "Average product", "It's okay"],
  2: ["Disappointed", "Below expectations", "Not great"],
  1: ["Do not buy", "Terrible quality", "Waste of money"],
};

const COMMENTS = {
  5: ["Works flawlessly and the build quality is excellent. Would buy again.",
      "Delivery was quick and the product is even better than described."],
  4: ["Good product for the price. A couple of small quirks but nothing serious.",
      "Does what it promises. Packaging could be better."],
  3: ["Usable, but I expected a bit more at this price point.",
      "Average experience — neither impressed nor disappointed."],
  2: ["Started having issues within a couple of weeks. Support was slow.",
      "Photos made it look much better than it actually is."],
  1: ["Stopped working after a few days. Returning it.",
      "Quality is far below what the listing claims."],
};

/**
 * Build review objects from already-inserted users and products.
 *
 * The reviews collection has a UNIQUE index on (product, user), so the
 * generator tracks used pairs and never produces a duplicate — otherwise
 * insertMany would fail with a duplicate-key (E11000) error.
 */
export function buildReviews(random, users, products, count = 200) {
  const reviews = [];
  const usedPairs = new Set();
  const reviewers = users.filter((user) => !user.deletedAt);

  let attempts = 0;
  while (reviews.length < count && attempts < count * 10) {
    attempts += 1;

    const user = pick(random, reviewers);
    const product = pick(random, products);

    const pairKey = `${product._id}-${user._id}`;
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    const rating = pick(random, RATING_POOL);

    reviews.push({
      product: product._id,
      user: user._id,
      rating,
      title: pick(random, TITLES[rating]),
      // ~20% of reviews are rating-only (no comment) -> $exists demos.
      ...(chance(random, 0.8) ? { comment: pick(random, COMMENTS[rating]) } : {}),
      helpfulVotes: randomInt(random, 0, 40),
      // Explicit createdAt (Mongoose only auto-fills timestamps when the
      // value is absent) so reviews are spread over the last 300 days.
      createdAt: dateWithinDays(random, 300),
    });
  }

  return reviews;
}
