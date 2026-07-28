/**
 * LESSON 09-data-modeling/03-denormalization-in-action — Living with a copy
 *
 * `product.ratingSummary` is a DENORMALIZED copy: the truth about ratings
 * lives in the reviews collection, but every product carries a cached
 * { average, count } so listing pages never run an aggregation. This lesson
 * walks the copy's whole lifecycle: why it exists (the read it saves), how
 * it drifts (writes that bypass the maintenance code), what one new review
 * does to it (the incremental math and its race), and the resync job that
 * repairs it from the source of truth.
 *
 * SAFETY: the drift experiment runs on a TEMPORARY product (SKU `ZZ-...`)
 * with TEMPORARY reviews (titles starting "ZZ practice"), swept at the start
 * and deleted in a finally-block cleanup. Seeded products and reviews are
 * only ever read.
 *
 * Run it with:  npm run lesson 09-data-modeling/03-denormalization-in-action
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Category from "../../../models/category.model.js";
import Product from "../../../models/product.model.js";
import Review from "../../../models/review.model.js";

// Temp-data markers shared by the whole bootcamp: product SKUs starting ZZ-
// are practice docs; this lesson's reviews are marked by their title prefix.
const TEMP_SKU = /^ZZ-/;
const TEMP_REVIEW_TITLE = /^ZZ practice/;

/**
 * DESTRUCTIVE — but only for practice docs matching the temp markers above.
 * Reviews are removed two ways on purpose: by pointing at a temp product
 * (the normal case) AND by title marker (catches reviews orphaned if a
 * previous run crashed after deleting the product but before the reviews).
 */
async function removeTempDocs() {
  const tempProducts = await Product.find({ sku: TEMP_SKU }).select("_id");
  const byProduct = await Review.deleteMany({
    product: { $in: tempProducts.map((p) => p._id) },
  });
  const byTitle = await Review.deleteMany({ title: TEMP_REVIEW_TITLE });
  const products = await Product.deleteMany({ sku: TEMP_SKU });
  return {
    tempReviewsRemoved: byProduct.deletedCount + byTitle.deletedCount,
    tempProductsRemoved: products.deletedCount,
  };
}

/** The source-of-truth calculation: aggregate a product's live rating stats
 *  straight from the reviews collection. Returns null when it has none. */
async function liveRatingStats(productId) {
  const [stats] = await Review.aggregate([
    { $match: { product: productId } },
    { $group: { _id: "$product", average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return stats ?? null;
}

await runLesson("Data modeling 3/3 — Denormalization in action", async () => {
  section("0. Safety sweep — remove practice docs a crashed run left behind");
  show("Leftovers removed (0 is normal)", await removeTempDocs());

  try {
    // ------------------------------------------------------------------
    section("1. Why the copy exists — the read it saves");
    // The hot read: a product listing shows "4.2 stars (12)" on EVERY card.
    // With the denormalized summary, that data is already ON the product —
    // the listing costs zero extra work:
    const popular = await Product.findOne({ "ratingSummary.count": { $gte: 3 } })
      .sort({ "ratingSummary.count": -1 })
      .select("name ratingSummary");
    if (!popular) throw new Error("Seeded data missing — run: npm run db:seed");
    show("The cached answer, free with the document", popular.toObject());

    // And here is what that copy is a cache OF — the live aggregate over
    // the source of truth (runs on the SERVER, scanning this product's
    // reviews via the { product: 1, createdAt: -1 } index's product prefix):
    const live = await liveRatingStats(popular._id);
    show("The live truth, computed from reviews on demand", live);
    note(
      "They agree — the seeder's last step ran exactly this aggregation and " +
        "wrote the results onto every product (seed.js step 7). Two details " +
        "to notice: (1) the stored average is ROUNDED to 1 decimal by " +
        "policy, the live one is a full float — decimal dust is rounding, " +
        "not drift; count must match EXACTLY. (2) The cost asymmetry: a " +
        "listing page of 24 products reads 24 documents either way, but " +
        "without the cache it would ALSO need a rating aggregation across " +
        "reviews per page view. Ratings change a few times a day; listings " +
        "render thousands of times an hour. Precomputing on the rare write " +
        "to serve the constant read IS denormalization's whole bargain."
    );

    // ------------------------------------------------------------------
    section("2. Build a sandbox — a temp product plus reviews that BYPASS the cache");
    // A temp product (ZZ- marker) in a real category, starting life with
    // the schema default ratingSummary of { average: 0, count: 0 }:
    const headphones = await Category.findOne({ slug: "headphones" });
    const reviewers = await User.find({ deletedAt: null }).limit(3).select("_id name");
    if (!headphones || reviewers.length < 3)
      throw new Error("Seeded data missing — run: npm run db:seed");

    const tmpProduct = await Product.create({
      name: "ZZ Practice Earbuds Pro",
      sku: "ZZ-MODEL-9001",
      description: "Practice product for the data-modeling module.",
      price: 2999,
      discountPercent: 10,
      stock: 25,
      category: headphones._id,
      specs: { brand: "EchoBeat", color: "black", warrantyMonths: 12 },
    });
    show("Temp product born with the default summary", {
      name: tmpProduct.name,
      sku: tmpProduct.sku,
      ratingSummary: tmpProduct.ratingSummary,
    });

    // Now write reviews STRAIGHT into the reviews collection without
    // touching the product — simulating every code path that forgets the
    // cache: a bulk import, an admin script, a second service, a migration.
    // (Three different seeded users + one temp product = three unique
    // (product, user) pairs; the unique index is satisfied, and no seeded
    // pair is disturbed.)
    await Review.create([
      { product: tmpProduct._id, user: reviewers[0]._id, rating: 5, title: "ZZ practice review — superb", helpfulVotes: 3 },
      { product: tmpProduct._id, user: reviewers[1]._id, rating: 4, title: "ZZ practice review — solid", helpfulVotes: 1 },
      { product: tmpProduct._id, user: reviewers[2]._id, rating: 3, title: "ZZ practice review — okay" },
    ]);
    note(
      "Nothing stopped us. MongoDB has no idea ratingSummary relates to " +
        "reviews — the link between a copy and its source exists ONLY in " +
        "application code, and we just wrote around that code. This is how " +
        "real drift is born: not through exotic failures, but through the " +
        "one write path that didn't know about the cache."
    );

    // ------------------------------------------------------------------
    section("3. Drift, made visible — the stored copy vs the live truth");
    const storedAfterReviews = await Product.findById(tmpProduct._id).select("name ratingSummary");
    const liveAfterReviews = await liveRatingStats(tmpProduct._id);
    show("Same product, two answers", {
      storedCopy: storedAfterReviews.ratingSummary, // still { 0, 0 } — stale
      liveTruth: { average: liveAfterReviews.average, count: liveAfterReviews.count }, // 4, 3
    });
    note(
      "The product page would now show 'no ratings yet' on a product with " +
        "three reviews averaging 4 stars. Neither read is wrong about what " +
        "it read — the COPY is stale. When copy and source disagree, the " +
        "source of truth wins by definition; that is what 'source of truth' " +
        "means, and why every denormalization needs a repair plan from day " +
        "one."
    );

    // ------------------------------------------------------------------
    section("4. What one new review WOULD do — the incremental math (no write)");
    // The well-behaved write path keeps the copy fresh as it goes. If a
    // 5-star review arrived now, the incremental update is pure arithmetic
    // on the current stats — no rescan of all reviews needed:
    const next = 5;
    const projected = {
      count: liveAfterReviews.count + 1,
      average:
        (liveAfterReviews.average * liveAfterReviews.count + next) /
        (liveAfterReviews.count + 1),
    };
    show("If a 5-star review landed next", {
      before: { average: liveAfterReviews.average, count: liveAfterReviews.count },
      newRating: next,
      after: projected, // (4*3 + 5) / 4 = 4.25, count 4
    });
    note(
      "newAvg = (avg*count + rating) / (count+1) — O(1) per review, which " +
        "is why apps run it inline when a review is created. But see the " +
        "RACE: two reviews submitted simultaneously both read count=3, both " +
        "compute count=4 — one update is lost. Remedies: recompute from the " +
        "source instead of incrementing (what section 5 does; slower, " +
        "always right), or push the arithmetic INTO the database — an " +
        "aggregation-pipeline update like updateOne({_id}, [{ $set: { " +
        "'ratingSummary.count': { $add: ['$ratingSummary.count', 1] } } }]) " +
        "reads the document's CURRENT values server-side, atomically, " +
        "eliminating the read-then-write gap (module 07's atomicity story)."
    );

    // ------------------------------------------------------------------
    section("5. The RESYNC — repair the copy from the source of truth");
    // The universal fix, identical in shape to seed.js step 7:
    // (1) aggregate the truth, (2) $set it onto the copy. Idempotent —
    // running it twice is harmless — which is exactly what you want in a
    // repair tool.
    const truth = await liveRatingStats(tmpProduct._id);
    await Product.updateOne(
      { _id: tmpProduct._id },
      {
        $set: {
          // Dot paths on purpose: replace the two leaves, not the whole
          // ratingSummary object (module 08's replacement-semantics trap).
          "ratingSummary.average": truth ? Math.round(truth.average * 10) / 10 : 0,
          "ratingSummary.count": truth ? truth.count : 0,
        },
      }
    );
    const repaired = await Product.findById(tmpProduct._id).select("name ratingSummary");
    const liveNow = await liveRatingStats(tmpProduct._id);
    show("After the resync — copy and truth agree again", {
      storedCopy: repaired.ratingSummary, // { average: 4, count: 3 }
      liveTruth: { average: liveNow.average, count: liveNow.count },
    });
    note(
      "The `truth ? ... : 0` branch matters in the real job: a product " +
        "whose last review was deleted gets NO aggregation row at all — " +
        "forgetting that case leaves ghost ratings on review-less products. " +
        "A production resync runs this same aggregate with $group over ALL " +
        "products and bulkWrite-s the results (exactly seed.js step 7) — " +
        "cheap enough to run nightly as a safety net."
    );

    // ------------------------------------------------------------------
    section("6. Where the sync code lives in production — and the two species of copy");
    note(
      "Real apps combine layers: (1) INLINE in the service function that " +
        "creates/edits/deletes a review — same request, copy fresh " +
        "immediately; (2) Mongoose middleware (post('save') on Review) — " +
        "convenient, but hooks DON'T fire for insertMany or raw " +
        "updateOne/deleteMany paths, so alone it's a leaky net; (3) change " +
        "streams or a queue feeding a background worker — survives " +
        "multi-service setups; (4) the nightly full resync — the safety net " +
        "that catches whatever slipped through 1–3. And keep the two " +
        "SPECIES of duplication straight: ratingSummary is a CACHE — drift " +
        "is a bug, resync forever. Order-item unitPrice (lesson 02, " +
        "section 7) is a SNAPSHOT — 'drift' is history working, and a " +
        "resync would falsify invoices. Same mechanism, opposite " +
        "maintenance contracts — label which one every copied field is on " +
        "the day you create it."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw, so no
    // practice doc can outlive the lesson.
    section("Cleanup — DESTRUCTIVE, but only for ZZ- products / ZZ practice reviews");
    show("Removed", await removeTempDocs());
    note("The database is back to exactly its seeded state.");
  }
});
