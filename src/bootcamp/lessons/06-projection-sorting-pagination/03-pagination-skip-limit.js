/**
 * LESSON 06-projection-sorting-pagination/03-pagination-skip-limit —
 * Page-number pagination
 *
 * "Page 3 of 42" pagination: the client sends a page number and a page
 * size, the server translates them into skip() + limit() on top of a
 * DETERMINISTIC sort, and returns the page plus metadata (total items,
 * total pages, has-next). This lesson builds the exact response shape a
 * production REST endpoint returns — and then shows the two structural
 * weaknesses of skip/limit (deep pages get linearly slower; pages shift
 * when data changes) that lesson 04 fixes with cursors.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 06-projection-sorting-pagination/03-pagination-skip-limit
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Pagination 1/2 — skip() + limit()", async () => {
  // --------------------------------------------------------------------
  section("1. Why paginate at all");
  // The total the server WOULD send without a limit:
  const totalOrders = await Order.estimatedDocumentCount();
  show("Orders in the collection", totalOrders);
  note(
    "300 orders would survive one unpaginated response — 3 million would " +
      "not (memory, network, JSON parsing, a frozen browser tab). " +
      "Pagination bounds EVERY response to a small fixed size, no matter " +
      "how much the collection grows. Every list endpoint you ever ship " +
      "should be paginated from day one."
  );

  // --------------------------------------------------------------------
  section("2. The mechanics: skip = (page - 1) * pageSize");
  const pageSize = 5;
  // skip(n): after sorting, the server walks PAST the first n matches and
  // discards them. limit(n): stop after returning n. Together they cut one
  // "window" out of the sorted result.
  // NOTE the sort ends in _id — the deterministic-order habit from lesson
  // 02. Without it, tie groups could reshuffle between the two requests
  // and the same product could appear on both pages.
  const page1 = await Product.find()
    .sort({ price: 1, _id: 1 })
    .skip((1 - 1) * pageSize) // page 1 -> skip 0
    .limit(pageSize)
    .select("name price -_id")
    .lean();
  const page2 = await Product.find()
    .sort({ price: 1, _id: 1 })
    .skip((2 - 1) * pageSize) // page 2 -> skip 5
    .limit(pageSize)
    .select("name price -_id")
    .lean();
  show("Products by price — page 1", page1);
  show("Products by price — page 2", page2);
  note(
    "The formula is (page - 1) * pageSize: page 1 skips 0, page 2 skips 5. " +
      "Off-by-one here (page * pageSize) silently hides the first page of " +
      "results — a classic bug. Also note chaining ORDER is irrelevant: " +
      ".limit(5).skip(5).sort(...) builds the same command; the server " +
      "always applies filter -> sort -> skip -> limit logically."
  );

  // --------------------------------------------------------------------
  section("3. A real endpoint: data + metadata via Promise.all");
  // A production API never returns a bare array — the client needs to know
  // how many pages exist to render the pager. That takes TWO queries: the
  // count of ALL matches, and the one page of data. They are independent,
  // so run them IN PARALLEL with Promise.all — two round trips for the
  // price of the slower one, instead of one after the other.
  async function getOrdersPage({ filter = {}, page = 1, pageSize = 10 }) {
    // Never trust client-supplied numbers (section 4 shows why):
    const safePage = Math.max(Number(page) || 1, 1);
    const safeSize = Math.min(Math.max(Number(pageSize) || 10, 1), 100);

    const [totalItems, data] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .sort({ placedAt: -1, _id: -1 }) // newest first, deterministic
        .skip((safePage - 1) * safeSize)
        .limit(safeSize)
        .select("orderNumber status totalAmount placedAt")
        .lean(),
    ]);

    const totalPages = Math.ceil(totalItems / safeSize);
    return {
      data,
      meta: {
        page: safePage,
        pageSize: safeSize,
        totalItems,
        totalPages,
        hasPrevPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
    };
  }

  // Simulate:  GET /api/orders?status=delivered&page=1&pageSize=5
  const p1 = await getOrdersPage({
    filter: { status: "delivered" },
    page: 1,
    pageSize: 5,
  });
  show("Delivered orders — page 1 (full API response)", p1);

  // Simulate:  GET /api/orders?status=delivered&page=2&pageSize=5
  const p2 = await getOrdersPage({
    filter: { status: "delivered" },
    page: 2,
    pageSize: 5,
  });
  show("Delivered orders — page 2, data only", p2.data);

  // Prove the two pages share no documents — this is what the
  // deterministic sort buys us on unchanging data.
  const page1Numbers = new Set(p1.data.map((o) => o.orderNumber));
  const overlap = p2.data.filter((o) => page1Numbers.has(o.orderNumber));
  show("Orders appearing on BOTH pages", overlap);
  note(
    "Empty overlap = clean page boundaries. The metadata is what the " +
      "frontend pager renders from: 'Page 1 of " +
      `${p1.meta.totalPages}' with Next enabled because hasNextPage is ` +
      "true. countDocuments (not estimatedDocumentCount) because the total " +
      "must respect the same FILTER as the page."
  );

  // --------------------------------------------------------------------
  section("4. Edge cases every endpoint must survive");
  // Past the last page: NOT an error — just an empty array. The API
  // returns data: [] and the client shows "no results".
  const wayPast = await getOrdersPage({
    filter: { status: "delivered" },
    page: 999,
    pageSize: 5,
  });
  show("Page 999 — empty data, meta still correct", wayPast);

  note(
    "Why the clamping in the helper matters: limit(0) means NO LIMIT in " +
      "MongoDB — an unvalidated ?pageSize=0 would return the entire " +
      "collection! pageSize=100000 is a self-inflicted outage, and a " +
      "negative skip is a server error. Clamp page to >= 1 and pageSize to " +
      "1..100 before they ever reach the query."
  );

  // --------------------------------------------------------------------
  section("5. The cost of deep skip — why page 10,000 crawls");
  // skip(n) is NOT a jump. To skip 290 sorted documents the server must
  // PRODUCE 290 sorted documents (or index keys) and throw them away, then
  // return the 5 you asked for.
  const deep = await Order.find()
    .sort({ placedAt: -1, _id: -1 })
    .skip(290)
    .limit(5)
    .select("orderNumber placedAt -_id")
    .lean();
  show("skip(290).limit(5) — the 5 oldest-ish orders", deep);
  note(
    "For this response the server walked 295 documents in sort order and " +
      "discarded 290 — on 300 docs, nothing. Now scale it: skip(100000) " +
      "walks and discards ONE HUNDRED THOUSAND entries first. Cost grows " +
      "LINEARLY with page number: page 1 touches pageSize keys, page N " +
      "touches N * pageSize. An index makes each step cheaper but cannot " +
      "make the walk shorter — that is simply how skip is defined."
  );

  // --------------------------------------------------------------------
  section("6. The shifting-window problem (thought experiment)");
  // This lesson is read-only, so picture it instead of running it:
  //
  //   newest-first positions: 1..5 = [O30 O29 O28 O27 O26]
  //   -> user loads page 1 (size 5) and sees O30..O26; O26 is the last row.
  //   -> a NEW order O31 arrives. Every document shifts DOWN one position:
  //      positions are now [O31 O30 O29 O28 O27 | O26 O25 ...]
  //   -> user clicks Next. Page 2 = skip(5) = "start at position 6",
  //      and position 6 is now... O26 — the row they JUST saw. Duplicate.
  note(
    "skip/limit pages are defined by POSITION ('rows 6-10'), and positions " +
      "move whenever documents are inserted or deleted ahead of them. " +
      "Insert -> the last row of page 1 reappears on page 2 (duplicate). " +
      "Delete -> a row slides up across the boundary unseen (skipped). No " +
      "error is thrown; the data is just quietly wrong. Harmless for an " +
      "admin table, unacceptable for a busy feed."
  );
  note(
    "Verdict on skip/limit: perfect fit for numbered-page UIs on moderate, " +
      "calm data (admin tables, search results) — the ONLY scheme that can " +
      "'jump to page 7'. Its two structural flaws — linear cost and " +
      "shifting windows — are both fixed by cursor pagination: lesson " +
      "04-pagination-cursor."
  );
});
