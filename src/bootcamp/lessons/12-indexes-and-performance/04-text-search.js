/**
 * LESSON 12-indexes-and-performance/04-text-search — Searching words, not patterns
 *
 * "Find products matching 'wireless headphones'" is not a filter — it is a
 * SEARCH. Users expect word matching, not substring matching; they expect
 * "running" to match "run"; and they expect the best match first.
 *
 * MongoDB's text index does all three. Our Product schema already declares
 * one over { name, description } with name weighted 5x. This lesson uses it,
 * scores results, compares it honestly against regex, and is equally honest
 * about where it falls short (and what you use instead).
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 12-indexes-and-performance/04-text-search
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";

/** Compact explain summary, so the output stays readable. */
const planOf = async (cursor) => {
  const explained = await cursor.explain("executionStats");
  const stats = explained.executionStats;
  const stages = [];
  let node = stats.executionStages;
  while (node) {
    stages.push(node.stage);
    node = node.inputStage ?? node.inputStages?.[0];
  }
  return {
    stages: stages.join(" <- "),
    keysExamined: stats.totalKeysExamined,
    docsExamined: stats.totalDocsExamined,
    returned: stats.nReturned,
    ms: stats.executionTimeMillis,
  };
};

await runLesson("Indexes 4/5 — Text search", async () => {
  // --------------------------------------------------------------------
  section("1. The text index we already have");
  const indexes = await Product.collection.listIndexes().toArray();
  const textIndex = indexes.find((ix) => ix.textIndexVersion);
  show("products text index", {
    name: textIndex?.name,
    weights: textIndex?.weights,
    defaultLanguage: textIndex?.default_language,
    languageOverride: textIndex?.language_override,
  });
  note(
    "Declared in product.model.js as { name: 'text', description: 'text' } " +
      "with weights { name: 5, description: 1 }. A collection may have AT " +
      "MOST ONE text index, though that one index can cover many fields — " +
      "so 'add a text index for the tags too' means dropping and rebuilding " +
      "the existing one with tags included."
  );

  // --------------------------------------------------------------------
  section("2. $text — a basic search");
  // $text splits your search string into words, applies the same stemming
  // and stop-word removal used when indexing, and matches ANY of the terms
  // (an OR).
  const basic = await Product.find(
    { $text: { $search: "wireless" } },
    { name: 1, price: 1, _id: 0 }
  ).limit(6).lean();
  show('$text: { $search: "wireless" }', basic);
  note(
    "The search ran against the INDEX of words, not the raw strings. That " +
      "is why it is fast and why it matches whole words only: searching " +
      "'wire' will NOT find 'wireless', because the index stores terms, not " +
      "substrings. Users expect this from a search box; it surprises " +
      "developers who expect LIKE '%wire%'."
  );

  // --------------------------------------------------------------------
  section("3. Relevance scoring — the whole point of a search");
  // $meta: "textScore" exposes the relevance score MongoDB computed. It is
  // available in a projection and in a sort.
  const scored = await Product.find(
    { $text: { $search: "premium wireless headphones" } },
    // The projection makes the score available as a field...
    { name: 1, price: 1, _id: 0, score: { $meta: "textScore" } }
  )
    // ...and the sort orders by it. Both use the same $meta expression.
    .sort({ score: { $meta: "textScore" } })
    .limit(8)
    .lean();
  show("Multi-word search, sorted by relevance", scored);
  note(
    "Higher score = better match. The score rises with term frequency, with " +
      "how many of the search terms appear, and with the field's WEIGHT — " +
      "our name field counts 5x, so a match in the product name outranks the " +
      "same word buried in a description. Without the explicit sort you get " +
      "results in index order, which for a search box looks random."
  );
  note(
    "Note the multi-word behaviour: 'premium wireless headphones' is an OR " +
      "over three terms. A product matching only 'premium' still appears, " +
      "just with a lower score. Section 4 shows how to demand all of them."
  );

  // --------------------------------------------------------------------
  section("4. Phrases, exclusion, and exact terms");
  const phrase = await Product.find(
    // Double quotes INSIDE the search string mean 'this exact phrase'.
    { $text: { $search: '"noise cancelling"' } },
    { name: 1, _id: 0, score: { $meta: "textScore" } }
  ).sort({ score: { $meta: "textScore" } }).limit(5).lean();
  show('Phrase search: \'"noise cancelling"\'', phrase);

  const excluded = await Product.find(
    // A leading minus EXCLUDES documents containing that term.
    { $text: { $search: "wireless -budget" } },
    { name: 1, _id: 0 }
  ).limit(5).lean();
  show('Exclusion: "wireless -budget"', excluded);
  note(
    "Three operators inside the search string: bare words = OR; \"quoted " +
      "phrase\" = must contain that exact sequence; -term = must NOT contain " +
      "it. There is no AND operator — the usual workaround is to require all " +
      "terms by quoting each one, or to filter the results further."
  );

  // --------------------------------------------------------------------
  section("5. Stemming and stop words — why 'running' matches 'run'");
  const stemPairs = [
    ["wireless", "wirelessly"],
    ["gaming", "game"],
    ["light", "lights"],
  ];
  const stemResults = {};
  for (const [a, b] of stemPairs) {
    stemResults[`"${a}" vs "${b}"`] = {
      [a]: await Product.countDocuments({ $text: { $search: a } }),
      [b]: await Product.countDocuments({ $text: { $search: b } }),
    };
  }
  show("Stemming reduces words to their root before matching", stemResults);
  note(
    "The index stores stems, so 'lights' and 'light' collapse to the same " +
      "entry. Stemming is LANGUAGE-SPECIFIC — the index was built with " +
      "default_language 'english'. Text in another language will not stem " +
      "correctly, and stop words ('the', 'and', 'is') are dropped entirely, " +
      "which is why searching for 'the' returns nothing."
  );

  // --------------------------------------------------------------------
  section("6. $text vs regex — an honest comparison");
  const textPlan = await planOf(Product.find({ $text: { $search: "wireless" } }));
  // An unanchored, case-insensitive regex cannot use an index at all.
  const regexPlan = await planOf(Product.find({ name: /wireless/i }));
  // An ANCHORED, case-sensitive regex CAN use an index (it becomes a range
  // scan over a prefix) — but only if one exists on that field.
  const anchoredPlan = await planOf(Product.find({ sku: /^LAP/ }));

  show("Three ways to match text", {
    "$text (uses the text index)": textPlan,
    "/wireless/i (unanchored, case-insensitive)": regexPlan,
    "/^LAP/ on the indexed sku (anchored)": anchoredPlan,
  });
  show("When to use which", {
    "$text": "user-facing search boxes: word matching, stemming, relevance ranking",
    "anchored regex /^abc/": "prefix lookups (autocomplete on an indexed field) — can use an index",
    "unanchored regex /abc/i": "always a collection scan. Fine on small collections, never on large ones.",
    "exact match": "always the fastest — use it when the user picks from a list, not a text box",
  });

  // --------------------------------------------------------------------
  section("7. Combining $text with ordinary filters");
  // The text index handles the words; a normal index cannot help the rest of
  // the filter in the same query, so MongoDB filters after fetching.
  const combined = await Product.find(
    {
      $text: { $search: "wireless" },
      isActive: true,
      price: { $lte: 20000 },
      stock: { $gt: 0 },
    },
    { name: 1, price: 1, stock: 1, _id: 0, score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(5)
    .lean();
  show("Search + business filters (the real e-commerce query)", combined);

  const combinedPlan = await planOf(
    Product.find({ $text: { $search: "wireless" }, isActive: true, price: { $lte: 20000 } })
  );
  show("Its plan", combinedPlan);
  note(
    "TEXT_MATCH does the word matching, then a FETCH loads the candidates " +
      "and a filter applies isActive and price in memory. MongoDB cannot use " +
      "the text index AND the price index in one pass. On a large catalogue " +
      "that matters: a broad search term produces thousands of candidates " +
      "that all get fetched before the price filter thins them out."
  );

  // --------------------------------------------------------------------
  section("8. $text inside an aggregation");
  // $text works in a $match, but ONLY in the FIRST stage of the pipeline.
  const searchFacets = await Product.aggregate([
    { $match: { $text: { $search: "premium" } } },
    // $meta is available here too, as an expression.
    { $addFields: { score: { $meta: "textScore" } } },
    {
      $facet: {
        top: [{ $sort: { score: -1 } }, { $limit: 3 }, { $project: { _id: 0, name: 1, score: 1 } }],
        priceBands: [
          {
            $bucket: {
              groupBy: "$price",
              boundaries: [0, 5000, 25000, 100000, 500000],
              default: "other",
              output: { count: { $sum: 1 } },
            },
          },
        ],
        total: [{ $count: "matches" }],
      },
    },
  ]);
  show("Search results with faceted counts — one query", searchFacets[0]);
  note(
    "This is a real faceted-search response: the top hits, plus how many " +
      "matches fall into each price band for the filter sidebar. $text must " +
      "be in the FIRST $match of the pipeline — putting it later is an error, " +
      "because the text index can only be consulted against the raw collection."
  );

  // --------------------------------------------------------------------
  section("9. Limitations you must know before shipping");
  show("What MongoDB text search cannot do", {
    "one index per collection": "you cannot have separate text indexes for different field sets",
    "no substring matching": "'head' will not find 'headphones' — only whole (stemmed) words",
    "no fuzzy matching / typo tolerance": "'headfones' returns nothing",
    "no autocomplete": "use an anchored regex on an indexed field, or a dedicated engine",
    "no per-field targeting at query time": "you cannot say 'search only the name field'",
    "limited relevance tuning": "weights are fixed at index-build time",
    "sort by score is a blocking sort": "the whole candidate set is scored before ranking",
    "language-specific": "stemming and stop words assume one language per document",
  });
  show("When you have outgrown it", {
    "Atlas Search": "built on Lucene: fuzzy, autocomplete, synonyms, per-field queries. Atlas only.",
    "Elasticsearch / OpenSearch": "the classic external search engine; you sync data into it",
    "Postgres full-text": "if you already run Postgres alongside",
    "the honest default": "MongoDB text search is fine for an admin search box or a modest catalogue",
  });
  note(
    "Next: 05-performance-patterns pulls everything together into a " +
      "practical checklist you can apply to a real slow endpoint."
  );
});
