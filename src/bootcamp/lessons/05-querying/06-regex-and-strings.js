/**
 * LESSON 05-querying/06-regex-and-strings — $regex, indexes, and safe input
 *
 * MongoDB has no LIKE — pattern matching on strings is done with regular
 * expressions. This lesson covers the two syntaxes, prefix vs contains
 * searches, the 'i' flag, WHY only an anchored case-SENSITIVE prefix can
 * use an index (with explain() output proving it), and how to escape user
 * input so a search box cannot crash — or regex-inject — your API.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 05-querying/06-regex-and-strings
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

/**
 * Section 4 helper: find the IXSCAN stage inside an explain() winning plan
 * (walking the inputStage chain), so we can compare its indexBounds.
 * Defensive on purpose — explain output varies across server versions.
 */
function findIxscan(explainResult) {
  let stage = explainResult?.queryPlanner?.winningPlan;
  while (stage) {
    if (stage.stage === "IXSCAN") return stage;
    stage = stage.inputStage ?? (Array.isArray(stage.inputStages) ? stage.inputStages[0] : undefined);
  }
  return null;
}

/**
 * Backslash-escape every character that means something special in a
 * regex, so user input is matched LITERALLY. ($& = the matched character.)
 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await runLesson("Querying 6/6 — Regex & string matching", async () => {
  // --------------------------------------------------------------------
  section("1. Two syntaxes for the same thing");
  // Syntax A: a JavaScript regex literal — great when the pattern is fixed
  // in your code. Mongoose passes it through to MongoDB as a BSON regex.
  const literal = await Product.countDocuments({ name: /Ultrabook/ });

  // Syntax B: the $regex operator with a STRING pattern — what you use
  // when the pattern arrives at runtime (from an API request, a config...).
  // $options carries the flags.
  const fromApi = "Ultrabook";
  const operator = await Product.countDocuments({
    name: { $regex: fromApi, $options: "" },
  });
  show("Products whose name contains 'Ultrabook'", {
    "JS literal /Ultrabook/": literal,
    "$regex string form": operator,
    identical: literal === operator,
  });
  note(
    "Same query on the wire either way. The matching itself runs on the " +
      "MongoDB SERVER (PCRE-compatible regex), not in Node — the pattern is " +
      "shipped with the query. Only laptops have 'Ultrabook' in their name, " +
      "so expect a handful of matches."
  );

  // --------------------------------------------------------------------
  section("2. Contains vs prefix — anchoring changes the question");
  // Unanchored = 'contains anywhere'. Product names look like
  // '<Brand> <Adjective> <Noun>', so /Volt/ finds Volt products no matter
  // where the word sits...
  const containsVolt = await Product.countDocuments({ name: /Volt/ });
  // ...while ^ anchors to the START: only names BEGINNING with 'Volt '.
  const startsVolt = await Product.countDocuments({ name: /^Volt / });
  show("'Volt' anywhere vs at the start", {
    "contains /Volt/": containsVolt,
    "prefix /^Volt /": startsVolt,
  });

  // Contains-search surprises people. Which cities contain 'bad'?
  const badCities = await User.distinct("address.city", { "address.city": /bad/ });
  const badPrefix = await User.distinct("address.city", { "address.city": /^bad/ });
  show("Cities matching /bad/ vs /^bad/", {
    "contains 'bad'": badCities,
    "starts with 'bad'": badPrefix,
  });
  note(
    "Ahmedabad contains 'bad'! An unanchored pattern scans the middle of " +
      "every string — semantically broader AND slower (section 4). Decide " +
      "consciously: prefix search (autocomplete, SKU families) -> anchor " +
      "with ^; genuine substring search -> consider $text/Atlas Search " +
      "before regex."
  );

  // --------------------------------------------------------------------
  section("3. Case sensitivity — the 'i' flag, and the better fix");
  // Regex is case-sensitive by default; names are stored 'Volt ...'.
  const lower = await Product.countDocuments({ name: /^volt / });
  const lowerI = await Product.countDocuments({ name: /^volt /i });
  show("Lowercase pattern without and with /i", {
    "/^volt /": lower,
    "/^volt /i": lowerI,
  });

  // The production-grade alternative: NORMALIZE AT WRITE TIME. Our User
  // schema declares `email: { lowercase: true }`, so every stored email is
  // already lowercase — an exact, index-friendly equality works no matter
  // how the user TYPES their email at login. Simulate a shouty login:
  const someUser = await User.findOne({ role: "admin" });
  const typedByUser = someUser.email.toUpperCase(); // "AARAV.SHARMA@GMAIL.COM"-style
  const found = await User.findOne({ email: typedByUser.toLowerCase() });
  show("Login lookup via normalized equality", {
    userTyped: typedByUser,
    matched: found?.email ?? "(no match)",
  });
  note(
    "/i rescues a query but costs the index (next section) and hides dirty " +
      "data. Normalizing on WRITE (Mongoose lowercase/trim setters) turns " +
      "case-insensitive lookups into plain fast equalities — the standard " +
      "pattern for emails, usernames, slugs, SKUs. (Bonus: since Mongoose 6, " +
      "setters also run on FILTER values, so even the un-lowercased lookup " +
      "would match through Mongoose — but never through the raw driver. " +
      "Explicit .toLowerCase() keeps the behavior obvious.) When you must " +
      "preserve original casing, a case-insensitive COLLATION index is the " +
      "database-side fix."
  );

  // --------------------------------------------------------------------
  section("4. Regex and indexes — only ^case-SENSITIVE prefixes get bounds");
  // The sku field has a unique index: its values are stored SORTED, like a
  // dictionary. A case-sensitive prefix /^LAP-/ defines a contiguous RANGE
  // of that dictionary — MongoDB can jump straight to 'LAP-' and stop when
  // the prefix ends. Compare three plans:
  const prefixPlan = await Product.find({ sku: /^LAP-/ }).explain("queryPlanner");
  const insensitivePlan = await Product.find({ sku: /^lap-/i }).explain("queryPlanner");
  const containsPlan = await Product.find({ sku: /1042/ }).explain("queryPlanner");

  const boundsOf = (plan) => findIxscan(plan)?.indexBounds?.sku ?? "(no IXSCAN found)";
  show("Index bounds for /^LAP-/ (case-sensitive prefix)", boundsOf(prefixPlan));
  show("Index bounds for /^lap-/i (case-INsensitive)", boundsOf(insensitivePlan));
  show("Index bounds for /1042/ (contains)", boundsOf(containsPlan));
  note(
    "The prefix query shows TIGHT bounds — roughly [\"LAP-\", \"LAP.\") — " +
      "only the LAP- block of the index is read. The /i and contains " +
      "versions show the full range [\"\", {}): MongoDB still walks the " +
      "index (it is smaller than the collection) but must test EVERY entry. " +
      "Why? The index is sorted case-SENSITIVELY: 'lap-...' entries would " +
      "sort far from 'LAP-...', and a mid-string '1042' can hide anywhere — " +
      "neither defines a contiguous range. Like a dictionary: 'words " +
      "starting with LAP' is one flip; 'words containing 1042' is reading " +
      "the whole book."
  );

  // --------------------------------------------------------------------
  section("5. Escaping user input — regex characters are OPERATORS");
  // Imagine a product search box. The user types a dot — to them a literal
  // character, to the regex engine 'match ANY character':
  const userTyped = "Phone.";
  const unsafe = await Product.countDocuments({ name: new RegExp(userTyped) });
  const safe = await Product.countDocuments({ name: new RegExp(escapeRegex(userTyped)) });
  show(`Search for '${userTyped}'`, {
    "unsafe new RegExp('Phone.')": unsafe,
    "escaped /Phone\\./": safe,
    escapedPatternSent: escapeRegex(userTyped),
  });
  note(
    "The unsafe version matched every 'Phone X' / 'Phone Pro' — the dot " +
      "swallowed the space. No product name literally contains 'Phone.', so " +
      "the escaped count is 0: the RIGHT answer to the question the user " +
      "actually asked."
  );

  // Worse: some inputs are not even VALID patterns. An unmatched '(' makes
  // new RegExp throw — in an Express route that is a 500 error from one
  // weird search string.
  const hostileInput = "Nexa (Pro";
  try {
    await Product.find({ name: new RegExp(hostileInput) });
  } catch (error) {
    show("new RegExp('Nexa (Pro') blew up", {
      name: error.name,
      message: error.message,
    });
  }
  const rescued = await Product.countDocuments({
    name: new RegExp(escapeRegex(hostileInput)),
  });
  show("Same input, escaped first — safe query, count", rescued);
  note(
    "Escape EVERY user-supplied string before building a regex from it " +
      "(the escapeRegex helper above — . * + ? ^ $ { } ( ) | [ ] \\ ). " +
      "Beyond crashes, crafted patterns can trigger catastrophic " +
      "backtracking (ReDoS) — e.g. nested quantifiers like (a+)+ against a " +
      "long non-matching string — pinning a CPU core on your DATABASE " +
      "server. Escaping removes that whole class of attack."
  );

  // --------------------------------------------------------------------
  section("6. The safe search-box pattern, end to end");
  // Anchored + escaped + explicit $options: index-friendly when the input
  // is clean, literal-safe always. This is the shape to copy into an API.
  const searchTerm = "EchoBeat"; // pretend: req.query.q
  const results = await Product.find({
    name: { $regex: `^${escapeRegex(searchTerm)}`, $options: "" },
    isActive: true,
  }).limit(5);
  show(
    `Autocomplete for '${searchTerm}' (first 5)`,
    results.map((p) => ({ name: p.name, sku: p.sku }))
  );

  // Negated regex from lesson 02, now with real teeth: everything NOT from
  // the Volt product line ($not is the only way to negate a regex).
  const nonVolt = await Product.countDocuments({ name: { $not: /^Volt / } });
  const total = await Product.countDocuments();
  show("Products NOT starting with 'Volt '", { nonVolt, ofTotal: total });
  note(
    "For real full-text search (word stemming, relevance ranking, multiple " +
      "fields) regex is the wrong tool — the products collection already " +
      "carries a text index over name+description for $text queries, and " +
      "Atlas Search goes further. Regex shines for prefixes, SKU families, " +
      "and small validated patterns — always escaped, ideally anchored."
  );
});
