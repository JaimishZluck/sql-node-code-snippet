/**
 * LESSON 09-data-modeling/02-relationships-tour — Every relationship, live
 *
 * A guided tour of the five seeded models, proving each relationship type
 * with the real query it was designed for: one-to-one (user.address,
 * embedded), one-to-few (order.items, embedded + snapshots), one-to-many
 * (category -> products, child-side reference), one-to-squillions
 * (user -> orders, reference + index only), many-to-many (reviews as a rich
 * join collection), and a self-referencing tree (categories). It ends with
 * the snapshot demo: making an order item's frozen unitPrice visibly differ
 * from the product's live finalPrice.
 *
 * SAFETY: read-only, with ONE exception — section 7 changes one product's
 * discountPercent to demonstrate snapshots, and reverts it moments later
 * (plus a crash-safe revert in the finally block). Nothing else is written.
 *
 * Run it with:  npm run lesson 09-data-modeling/02-relationships-tour
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Category from "../../../models/category.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import Review from "../../../models/review.model.js";

await runLesson("Data modeling 2/3 — A tour of every relationship", async () => {
  // If section 7's temporary price change is applied, its undo info lands
  // here so the finally block can revert even after a crash mid-section.
  let priceRevert = null;

  try {
    // ------------------------------------------------------------------
    section("1. One-to-one, EMBEDDED — user.address");
    // The access pattern: profile page / shipping form — always user AND
    // address together. Embedded means ONE read returns both; there is no
    // addresses collection, no join, nothing to keep consistent.
    const mumbaikar = await User.findOne({ "address.city": "Mumbai", deletedAt: null })
      .select("name email address");
    if (!mumbaikar) throw new Error("Seeded data missing — run: npm run db:seed");
    show("One read = user + address", mumbaikar.toObject());

    // The flip side of embedding a one-to-one: the field can simply be ABSENT.
    const noAddress = await User.countDocuments({ address: { $exists: false } });
    show("Users with NO address field at all", noAddress);
    note(
      "~15% of seeded users have no address — not null, not an empty " +
        "object: the key does not exist (there is no NULL row and no failed " +
        "join to warn you). Code must read it as user.address?.city. " +
        "Scoring the five questions: owned yes, bounded (it's one), read " +
        "together yes, shared no, updated independently no — five for five, " +
        "the easiest embed call there is."
    );

    // ------------------------------------------------------------------
    section("2. One-to-FEW, EMBEDDED — order.items");
    // Line items: owned by exactly this order, bounded by checkout rules
    // (1–4 in our seed), and always displayed with the order. So they live
    // INSIDE it — the invoice is one self-contained document.
    const order = await Order.findOne({ status: "delivered" })
      .select("orderNumber items totalAmount status");
    if (!order) throw new Error("Seeded data missing — run: npm run db:seed");
    show("A delivered order — items arrived WITH it, zero extra queries", order.toObject());

    // Because everything is local, the invoice math is verifiable without
    // touching any other collection:
    const itemSum = order.items.reduce((sum, item) => sum + item.subtotal, 0);
    show("Sum of embedded subtotals vs stored totalAmount", {
      itemSum,
      totalAmount: order.totalAmount,
      consistent: itemSum === order.totalAmount,
    });
    note(
      "totalAmount is itself a tiny WITHIN-document denormalization — " +
        "derivable from items, but stored so 'orders above 50k' can be a " +
        "plain indexed filter instead of per-document math. Safe here " +
        "because an order is write-once: after checkout, items never " +
        "change, so the copy cannot drift. Also spot the snapshot fields " +
        "(productName, unitPrice) inside each item — section 7 is about them."
    );

    // ------------------------------------------------------------------
    section("3. One-to-MANY, REFERENCED — category <- products");
    // A category is shared by many products and products outnumber it
    // without bound — so the CHILD holds the link: product.category is an
    // ObjectId. The category document knows nothing about its products.
    const laptops = await Category.findOne({ slug: "laptops" });
    if (!laptops) throw new Error("Seeded data missing — run: npm run db:seed");
    show("The parent — note: NO productIds array anywhere on it", laptops.toObject());

    const laptopCount = await Product.countDocuments({ category: laptops._id });
    // The reverse lookup "products of this category" is only cheap because
    // the compound index { category: 1, price: -1 } serves this exact
    // filter + sort in one index walk (module 12 shows the plan).
    const premium = await Product.find({ category: laptops._id })
      .sort({ price: -1 })
      .limit(3)
      .select("name sku price category")
      // populate(): Mongoose's app-side join — it collects the stored ids,
      // runs ONE extra query on categories, and merges the docs in memory.
      .populate("category", "name slug");
    show(`Top 3 of ${laptopCount} laptops by price (category populated)`, premium);
    note(
      "The ObjectId in product.category was swapped for the real category " +
        "document by populate() — that convenience cost one extra query. " +
        "Why not store productIds[] on the category instead? Unbounded " +
        "growth, a write to the category on EVERY product insert/delete " +
        "(one hot document), and it still couldn't carry per-product data. " +
        "A child-side ObjectId is constant-size forever. MongoDB enforces " +
        "NOTHING about it — `ref` is Mongoose metadata; deleting the " +
        "category would leave 9 dangling ids and no error."
    );

    // ------------------------------------------------------------------
    section("4. One-to-SQUILLIONS — user <- orders (parent knows nothing)");
    // Orders per customer is unbounded — so not even an array of order ids
    // lives on the user. The child's reference + one compound index IS the
    // relationship. First, find the busiest customer (an aggregation over
    // the child side — the parent couldn't answer this even if it wanted to):
    const [busiest] = await Order.aggregate([
      { $group: { _id: "$user", orders: { $sum: 1 }, spent: { $sum: "$totalAmount" } } },
      { $sort: { orders: -1 } },
      { $limit: 1 },
    ]);
    const heavyUser = await User.findById(busiest._id).select("name email role");
    show("The store's busiest customer — their USER doc holds no trace of orders", {
      user: heavyUser.toObject(),
      orderCount: busiest.orders,
      lifetimeSpend: busiest.spent,
    });

    // The home query of this shape: "this user's orders, newest first" —
    // served entirely by the { user: 1, placedAt: -1 } index.
    const recent = await Order.find({ user: heavyUser._id })
      .sort({ placedAt: -1 })
      .limit(3)
      .select("orderNumber totalAmount status placedAt");
    show("Their 3 newest orders (indexed filter + sort, paginated)", recent);
    note(
      "'Squillions' is the classic MongoDB term for 'many with no ceiling'. " +
        "At that scale the parent must know NOTHING about its children — " +
        "embedded orders would hit 16 MB, and even an id array would grow " +
        "forever and turn the user into a hot document rewritten on every " +
        "checkout. Child-ref + index scales to millions of orders, and " +
        "reads stay paginated (module 06) because the model quietly made " +
        "'fetch ALL their orders' possible — never do it."
    );

    // ------------------------------------------------------------------
    section("5. MANY-to-MANY — reviews, the rich join collection");
    // Many users review many products: unbounded in both directions, so
    // neither side can embed or even hold id arrays. Each review document
    // is one (product, user) PAIR — like a SQL junction-table row, except
    // it carries rich data of its own (rating, title, votes).
    const [prolific] = await Review.aggregate([
      { $group: { _id: "$user", reviews: { $sum: 1 } } },
      { $sort: { reviews: -1 } },
      { $limit: 1 },
    ]);
    // Direction 1: user -> products they reviewed.
    const theirReviews = await Review.find({ user: prolific._id })
      .limit(3)
      .select("rating title product")
      .populate("product", "name");
    show(`Direction 1 — ${prolific.reviews} reviews by one user (3 shown)`, theirReviews);

    // Direction 2: product -> users who reviewed it. Served by the
    // { product: 1, createdAt: -1 } index — each direction needs its own.
    const popular = await Product.findOne({ "ratingSummary.count": { $gte: 3 } })
      .sort({ "ratingSummary.count": -1 })
      .select("name ratingSummary");
    const itsReviews = await Review.find({ product: popular._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("rating title user createdAt")
      .populate("user", "name");
    show(`Direction 2 — newest reviews of "${popular.name}"`, itsReviews);

    // Bonus: VIRTUAL POPULATE. The product stores no review ids at all,
    // yet populate("reviews") works — the virtual on the schema says
    // "match reviews whose `product` field equals my _id" and Mongoose
    // runs that child-side query for you. Nothing extra is stored.
    const viaVirtual = await Product.findById(popular._id)
      .select("name")
      .populate({
        path: "reviews",
        select: "rating title product",
        options: { sort: { createdAt: -1 }, limit: 2 },
      });
    show(
      "Virtual populate — parent-side navigation with zero stored ids",
      viaVirtual.reviews.map((r) => ({ rating: r.rating, title: r.title }))
    );
    note(
      "The unique compound index { product: 1, user: 1 } is the junction " +
        "table's composite primary key reborn: one review per pair, " +
        "enforced by MONGODB itself (E11000) — app code alone can't stop " +
        "two simultaneous submissions. Contrast with arrays of ids on " +
        "either side: user.reviewedProducts[] / product.reviewerIds[] " +
        "would grow without bound on the product side, need TWO copies of " +
        "every link kept in sync, and have nowhere to put the rating. " +
        "Array-of-ids many-to-many is only for small, capped, payload-free " +
        "link sets (a book's 2–3 authors); everything bigger gets a join " +
        "collection."
    );

    // ------------------------------------------------------------------
    section("6. PARENT-CHILD self-reference — the category tree");
    // Each category may point at another IN THE SAME collection: parent is
    // an ObjectId (null for roots). The whole tree is 10 small documents —
    // so fetch them ALL in one query and assemble in memory.
    const allCats = await Category.find().select("name slug parent").lean();
    const roots = allCats.filter((c) => c.parent === null);
    const childrenOf = new Map();
    for (const cat of allCats) {
      if (!cat.parent) continue;
      const key = String(cat.parent);
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key).push(cat);
    }
    const treeLines = [];
    for (const root of roots) {
      treeLines.push(root.name);
      for (const child of childrenOf.get(String(root._id)) ?? []) {
        treeLines.push(`   \\-- ${child.name}`);
      }
    }
    show("The tree — ONE query + in-memory assembly", treeLines);

    // The self-reference resolving through populate — same mechanics as any
    // ref, the target model just happens to be Category itself:
    const laptopsWithParent = await Category.findOne({ slug: "laptops" })
      .select("name slug parent")
      .populate("parent", "name slug");
    show("laptops.parent populated (Category -> Category)", laptopsWithParent.toObject());
    note(
      "This is the PARENT-REFERENCE tree pattern — the right default for " +
        "small, shallow, read-mostly trees. Know the alternatives for when " +
        "trees get deep: MATERIALIZED PATH stores the route as a string " +
        "('electronics/laptops') so a whole subtree is one indexed prefix " +
        "regex; ANCESTORS ARRAY stores every ancestor id so 'all " +
        "descendants of X' is one multikey-indexed equality query. Both buy " +
        "subtree reads by making moves/renames rewrite descendants — " +
        "denormalization again. For recursion on parent-refs, aggregation " +
        "has $graphLookup. And remember: no foreign keys means nothing " +
        "stops a cycle or an orphan except your code."
    );

    // ------------------------------------------------------------------
    section("7. SNAPSHOTS — the order item that refuses to follow the price");
    // Order items carry productName + unitPrice COPIED at purchase time.
    // First, a store-wide drift AUDIT (pure read): join every order item to
    // its live product and keep items whose frozen price no longer matches.
    // finalPrice is a Mongoose VIRTUAL — it runs in Node, so the server has
    // never heard of it; the pipeline must rebuild the same formula with
    // aggregation operators.
    const driftPipeline = (extraMatch = {}) => [
      { $unwind: "$items" },
      { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "live" } },
      { $unwind: "$live" },
      {
        $addFields: {
          liveFinalPrice: {
            $round: [
              { $multiply: ["$live.price", { $subtract: [1, { $divide: ["$live.discountPercent", 100] }] }] },
              0,
            ],
          },
        },
      },
      { $match: { $expr: { $ne: ["$items.unitPrice", "$liveFinalPrice"] }, ...extraMatch } },
      {
        $project: {
          _id: 0,
          orderNumber: 1,
          productName: "$items.productName",
          paidThen: "$items.unitPrice",
          currentPrice: "$liveFinalPrice",
        },
      },
      { $limit: 5 },
    ];
    const driftNow = await Order.aggregate(driftPipeline());
    show("Price-drift audit across all 300 orders (fresh seed: expect [])", driftNow);
    note(
      "Empty on freshly seeded data — and that's correct: the seeder froze " +
        "each unitPrice with the SAME formula finalPrice uses today, and no " +
        "price has changed since. In production this list grows every day " +
        "the catalog moves, and that is the snapshot doing its job: orders " +
        "keep history while products live in the present."
    );

    // Now make time pass. Take a real ordered item, change its product's
    // discount, and watch the two values separate. TEMPORARY mutation —
    // reverted a few lines down (and in `finally` if we crash before that).
    const sampleOrder = await Order.findOne({ status: "delivered" }).select("orderNumber items");
    const sampleItem = sampleOrder.items[0];
    const liveProduct = await Product.findById(sampleItem.product);
    priceRevert = { _id: liveProduct._id, discountPercent: liveProduct.discountPercent };

    // Pick whichever discount value actually moves the price.
    // `timestamps: false` stops Mongoose from bumping updatedAt on this
    // write — after the revert below, the document is bit-for-bit as seeded.
    const tempDiscount = liveProduct.discountPercent === 0 ? 30 : 0;
    await Product.updateOne(
      { _id: liveProduct._id },
      { $set: { discountPercent: tempDiscount } },
      { timestamps: false }
    );
    const productNow = await Product.findById(liveProduct._id).select("name price discountPercent");

    show("Marketing just changed the discount — snapshot vs live", {
      orderItem: {
        order: sampleOrder.orderNumber,
        productName: sampleItem.productName, // frozen name
        unitPrice: sampleItem.unitPrice, // frozen price — did NOT move
      },
      productToday: {
        name: productNow.name,
        discountPercent: productNow.discountPercent,
        finalPrice: productNow.finalPrice, // virtual — moved with the discount
      },
    });

    // The audit now finds it — an order item whose unitPrice differs from
    // the product's current finalPrice:
    const driftAfter = await Order.aggregate(
      driftPipeline({ "items.product": liveProduct._id })
    );
    show("The audit catches the divergence", driftAfter);

    // Revert IMMEDIATELY — the seeded catalog must leave exactly as found.
    await Product.updateOne(
      { _id: priceRevert._id },
      { $set: { discountPercent: priceRevert.discountPercent } },
      { timestamps: false }
    );
    priceRevert = null;
    note(
      "(Product discount reverted — seeded data unchanged.) The order item " +
        "held still while finalPrice moved: that difference is not drift to " +
        "repair, it is HISTORY working. If items stored only a product ref, " +
        "every catalog edit would silently rewrite past invoices — a " +
        "correctness bug with accounting consequences. Note the hybrid: the " +
        "item ALSO keeps the live `product` ObjectId, so 'buy again' can " +
        "still populate today's product. Reference for the present, " +
        "snapshot for the past, side by side."
    );

    // ------------------------------------------------------------------
    section("8. The map — five models, every pattern");
    note(
      "User: embeds its one-to-one (address) and its tiny primitive arrays; " +
        "holds NO trace of orders/reviews. Category: self-referencing tree, " +
        "no child arrays. Product: child-side ref to category, embedded " +
        "specs, denormalized ratingSummary (lesson 03), computed finalPrice " +
        "virtual, virtual-populated reviews. Order: referenced user " +
        "(squillions), embedded bounded items with snapshots, snapshot " +
        "shippingAddress, denormalized totalAmount. Review: the rich join " +
        "collection with its junction-style unique index. One store, every " +
        "relationship pattern — each one chosen by asking what the app " +
        "READS most, which is the whole method."
    );
  } finally {
    // Crash safety for section 7's temporary discount change: if the lesson
    // died between mutation and revert, restore the original value now.
    section("Cleanup — revert the temporary price change (if still pending)");
    if (priceRevert) {
      await Product.updateOne(
        { _id: priceRevert._id },
        { $set: { discountPercent: priceRevert.discountPercent } },
        { timestamps: false }
      );
      show("Reverted discountPercent on", priceRevert);
    } else {
      note("Nothing to revert — the discount change was already undone in section 7.");
    }
  }
});
