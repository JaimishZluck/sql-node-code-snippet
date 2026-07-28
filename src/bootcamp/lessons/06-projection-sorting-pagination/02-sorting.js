/**
 * LESSON 06-projection-sorting-pagination/02-sorting — Ordering results
 *
 * sort() tells the MongoDB SERVER what order to return documents in:
 * cheapest first, newest first, best-rated first. This lesson covers both
 * sort syntaxes, multi-field sorts, sorting nested fields and dates, what
 * happens to documents MISSING the sort field, string sorting + collation,
 * the sort memory limit — and the single most important habit in this whole
 * module: ties are non-deterministic until you append a unique tiebreaker.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 06-projection-sorting-pagination/02-sorting
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";
import Category from "../../../models/category.model.js";

await runLesson("Sorting — sort(), ties, and determinism", async () => {
  // --------------------------------------------------------------------
  section("1. Without sort() there is NO promised order");
  // No sort = "natural order": roughly however the documents lie in storage.
  // It often LOOKS like insertion order on a fresh database — but MongoDB
  // guarantees nothing, and the order can change as documents move.
  const unordered = await Order.find()
    .limit(3)
    .select("orderNumber placedAt -_id")
    .lean();
  show("Three orders in natural (unspecified) order", unordered);
  note(
    "Rule: if the order matters — to a user, a test, or pagination — say so " +
      "with sort(). 'It came back sorted on my machine' is a coincidence, " +
      "not a contract."
  );

  // --------------------------------------------------------------------
  section("2. Single-field sort — object syntax, 1 and -1");
  // { price: 1 } = ascending (smallest first). The sort runs on the SERVER;
  // combined with limit(), only 5 documents ever cross the network.
  const cheapest = await Product.find({ isActive: true, stock: { $gt: 0 } })
    .sort({ price: 1 })
    .limit(5)
    .select("name price -_id")
    .lean();
  show("5 cheapest in-stock products (price: 1)", cheapest);

  // { placedAt: -1 } = descending. For dates that means NEWEST FIRST — the
  // single most common sort in any application.
  const newest = await Order.find()
    .sort({ placedAt: -1 })
    .limit(3)
    .select("orderNumber placedAt totalAmount -_id")
    .lean();
  show("3 newest orders (placedAt: -1)", newest);
  note(
    "Memorize the directions: 1 = ascending (A->Z, 0->9, oldest->newest), " +
      "-1 = descending. Dates compare chronologically, so 'newest first' is " +
      "always -1."
  );

  // --------------------------------------------------------------------
  section("3. String syntax — Mongoose shorthand");
  // Mongoose also accepts a string: "-placedAt" means placedAt descending.
  // Same command on the wire as the object version.
  const newestAgain = await Order.find()
    .sort("-placedAt")
    .limit(1)
    .select("orderNumber placedAt -_id")
    .lean();
  show("sort('-placedAt') — same as { placedAt: -1 }", newestAgain);
  note(
    "Pitfall: sort('placedAt: -1') is WRONG — that string is neither " +
      "syntax. Either sort('-placedAt') or sort({ placedAt: -1 }). Prefer " +
      "the object form when the field name comes from a variable."
  );

  // --------------------------------------------------------------------
  section("4. Multi-field sort — ties broken by the NEXT key");
  // "Best-rated first; among equally-rated products, cheapest first."
  // The second key only matters WHERE documents tie on the first — key
  // order in the object/string is significant.
  const topRated = await Product.find({ "ratingSummary.count": { $gte: 2 } })
    .sort("-ratingSummary.average price")
    .limit(6)
    .select("name price ratingSummary -_id")
    .lean();
  show("Top-rated, then cheapest (-ratingSummary.average price)", topRated);
  note(
    "Read a multi-field sort like a spreadsheet: sort by column A; only " +
      "rows equal in A are then sorted by column B. Note the sort keys are " +
      "NESTED fields (ratingSummary.average) — dot notation works in sort " +
      "exactly as in filters and projections."
  );

  // --------------------------------------------------------------------
  section("5. Documents MISSING the sort field");
  // ~15% of seeded users have no `age`. In BSON, missing/null values rank
  // BEFORE all numbers, so ascending age puts the age-less users FIRST.
  const byAgeAsc = await User.find()
    .sort({ age: 1 })
    .limit(5)
    .select("name age -_id")
    .lean();
  show("sort({ age: 1 }) — missing ages float to the top", byAgeAsc);

  const byAgeDesc = await User.find()
    .sort({ age: -1 })
    .limit(3)
    .select("name age -_id")
    .lean();
  show("sort({ age: -1 }) — oldest users, missing ages sink last", byAgeDesc);
  note(
    "MongoDB compares across TYPES using a fixed ranking: missing/null < " +
      "numbers < strings < objects < ... So an ascending sort on a " +
      "sometimes-missing field starts with the documents that lack it — a " +
      "classic surprise on 'sort by age' screens. If that is wrong for your " +
      "UI, filter them out ({ age: { $ne: null } }) or handle them app-side."
  );

  // --------------------------------------------------------------------
  section("6. Ties — the hidden bug in every naive sort");
  // 300 orders share just 5 status values, so sorting by status creates
  // huge groups of TIES. Within a tie, MongoDB may return documents in ANY
  // order — run the identical query twice and compare.
  const runA = await Order.find()
    .sort({ status: 1 })
    .limit(3)
    .select("orderNumber status -_id")
    .lean();
  const runB = await Order.find()
    .sort({ status: 1 })
    .limit(3)
    .select("orderNumber status -_id")
    .lean();
  show("Same tie-heavy query, run A", runA);
  show("Same tie-heavy query, run B", runB);
  note(
    "The two runs probably match RIGHT NOW — same data, same query plan. " +
      "That is exactly what makes this bug nasty: the order within ties is " +
      "UNSPECIFIED, and it silently changes when an index is added, the " +
      "plan changes, or documents move. Code that depends on it works in " +
      "dev and breaks in production."
  );

  // The fix: append a UNIQUE field as the final sort key. _id is always
  // there and always unique — with it, no two documents can ever tie, so
  // the total order is fully deterministic, forever.
  const deterministic = await Order.find()
    .sort({ status: 1, _id: 1 })
    .limit(3)
    .select("orderNumber status -_id")
    .lean();
  show("Deterministic version: sort({ status: 1, _id: 1 })", deterministic);
  note(
    "THE habit of this module: any sort that feeds pagination MUST end in a " +
      "unique tiebreaker — in practice, _id. Without it, page boundaries " +
      "fall inside tie groups that can reshuffle between requests: users " +
      "see the same order on page 2 AND page 3, or never see one at all. " +
      "Both pagination lessons build directly on this line."
  );

  // --------------------------------------------------------------------
  section("7. Sorting strings — binary order and collation");
  // Default string comparison is BINARY (by UTF-8 code point): every
  // uppercase letter ranks before every lowercase one, so "Zebra" < "apple".
  const binaryOrder = await Product.find()
    .sort({ name: 1 })
    .limit(4)
    .select("name -_id")
    .lean();
  show("Default (binary) name sort", binaryOrder);

  // Collation applies LANGUAGE rules instead. strength: 2 = compare
  // case-insensitively (and accent-aware). The comparison happens on the
  // server, per query.
  const humanOrder = await Product.find()
    .sort({ name: 1 })
    .collation({ locale: "en", strength: 2 })
    .limit(4)
    .select("name -_id")
    .lean();
  show("Case-insensitive sort via collation", humanOrder);
  note(
    "Seeded product names all start with capitals, so both lists likely " +
      "look identical here — the difference appears the moment 'iPhone " +
      "case' meets 'Zebra lamp'. Related trap: NUMERIC STRINGS sort " +
      "lexicographically ('10' < '9'). Store numbers as numbers, or use " +
      "collation({ numericOrdering: true }) as a band-aid."
  );

  // --------------------------------------------------------------------
  section("8. Where the sort actually happens — memory vs indexes");
  // An index stores keys ALREADY IN ORDER. If a sort matches an index, the
  // server just walks the index and streams results — no buffering. Our
  // seeded compound index { category: 1, price: -1 } serves exactly this
  // query (filter by category + sort by price) in one index walk:
  const laptops = await Category.findOne({ slug: "laptops" })
    .select("_id name")
    .lean();
  const priciestLaptops = await Product.find({ category: laptops._id })
    .sort({ price: -1 })
    .limit(3)
    .select("name price -_id")
    .lean();
  show(`Priciest ${laptops.name} (index-served sort)`, priciestLaptops);
  note(
    "A sort NO index can serve is a 'blocking sort': the server must load " +
      "ALL matches into memory, sort them, then start answering — with a " +
      "~100 MB ceiling per sort. Older servers abort with " +
      "QueryExceededMemoryLimitNoDiskUseAllowed; MongoDB 6+ spills to disk " +
      "by default, which avoids the error but is slow. Invisible on 300 " +
      "seeded orders, brutal on 10 million real ones. The real fix is an " +
      "index that matches the sort — module 12-indexes-and-performance " +
      "shows how to design them and how explain() reveals which kind of " +
      "sort you got."
  );
});
