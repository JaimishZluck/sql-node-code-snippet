/**
 * LESSON 06-projection-sorting-pagination/04-pagination-cursor —
 * Cursor (keyset) pagination
 *
 * Instead of "skip N rows" (which the server must walk and discard, and
 * which shifts when data changes), cursor pagination remembers WHERE the
 * last page ended — the sort-key values of its last document — and asks
 * for "everything strictly after that position". Every page is a cheap
 * index-range read, and inserts can no longer duplicate or hide rows.
 * This is how feeds, infinite scroll, and big-API pagination (GitHub,
 * Stripe, Relay/GraphQL) actually work.
 *
 * This lesson paginates orders newest-first on the compound key
 * (placedAt, _id), builds the $or continuation filter by hand, wraps it
 * into a production-shaped helper with opaque base64url cursors, proves
 * pages never overlap, and cross-checks the result against skip/limit.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 06-projection-sorting-pagination/04-pagination-cursor
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";

// Small display helper: an order as one compact line.
const brief = (o) => ({
  orderNumber: o.orderNumber,
  placedAt: o.placedAt.toISOString(),
  totalAmount: o.totalAmount,
});

await runLesson("Pagination 2/2 — cursors (keyset)", async () => {
  const PAGE_SIZE = 5;
  // The ONE sort this whole lesson is built on: newest first, with _id as
  // the unique tiebreaker (lesson 02's habit). A cursor is only meaningful
  // for the exact sort it was created under.
  const SORT = { placedAt: -1, _id: -1 };

  // --------------------------------------------------------------------
  section("1. The idea: remember WHERE you stopped, not HOW FAR you came");
  // Page 1 needs no cursor — it is simply the first PAGE_SIZE documents in
  // sort order.
  const page1 = await Order.find()
    .sort(SORT)
    .limit(PAGE_SIZE)
    .select("orderNumber status totalAmount placedAt")
    .lean();
  show("Page 1 (newest 5 orders)", page1.map(brief));

  // The CURSOR is nothing magical: the sort-key values of the LAST document
  // we returned. It names an exact position in the sorted sequence.
  const last = page1[page1.length - 1];
  const cursor = { placedAt: last.placedAt, id: last._id };
  show("Cursor = sort keys of the last row of page 1", {
    placedAt: cursor.placedAt.toISOString(),
    id: cursor.id.toString(),
  });
  note(
    "skip/limit says 'give me rows 6-10' (a POSITION — moves when data " +
      "changes). A cursor says 'give me what comes after THIS order' (a " +
      "VALUE — fixed forever). That one change fixes both problems from " +
      "lesson 03."
  );

  // --------------------------------------------------------------------
  section("2. Why the cursor needs TWO fields: (placedAt, _id)");
  note(
    "Could the cursor be placedAt alone? No — placedAt is not unique. If " +
      "two orders shared the exact timestamp and the page boundary fell " +
      "between them, 'placedAt < cursor' would SKIP the twin (and " +
      "'placedAt <= cursor' would REPEAT the whole row). Adding _id — " +
      "unique, always present — makes every position unambiguous. The " +
      "cursor must contain exactly the sort keys, and the sort must be " +
      "deterministic: the two requirements are one and the same."
  );

  // --------------------------------------------------------------------
  section("3. Page 2 by hand — the $or continuation filter");
  // "Strictly after the cursor position", under sort placedAt: -1, _id: -1:
  //
  //   branch 1: placedAt is strictly OLDER than the cursor's
  //             -> definitely after it, whatever its _id
  //   branch 2: placedAt is EXACTLY the cursor's (a tie on the 1st key)
  //             -> only rows later in the tie-order: _id < cursor.id
  //                ($lt again, because _id is ALSO sorted descending)
  //
  // Every comparison direction mirrors the sort direction. For an
  // ascending sort you would flip both $lt to $gt.
  const page2 = await Order.find({
    $or: [
      { placedAt: { $lt: cursor.placedAt } },
      { placedAt: cursor.placedAt, _id: { $lt: cursor.id } },
    ],
  })
    .sort(SORT)
    .limit(PAGE_SIZE)
    .select("orderNumber status totalAmount placedAt")
    .lean();
  show("Page 2 via cursor filter", page2.map(brief));
  note(
    "No skip() anywhere! The filter jumps STRAIGHT to the cursor position " +
      "— with an index on the sort keys that is one index seek, then " +
      "PAGE_SIZE sequential reads. Page 2 costs the same as page 2,000,000 " +
      "would: O(pageSize). Compare lesson 03, where skip(N) had to walk N " +
      "discarded documents first."
  );

  // --------------------------------------------------------------------
  section("4. Production shape — opaque cursors + hasNextPage");
  // Real APIs do not hand clients a raw { placedAt, _id } object — they
  // serialize it into one opaque token the client stores and echoes back
  // WITHOUT understanding it. That keeps clients from depending on your
  // sort internals (you can change them later without breaking anyone).
  const encodeCursor = (c) =>
    Buffer.from(
      // toISOString keeps millisecond precision — truncate it and the
      // cursor points at a slightly different position (rows get skipped).
      JSON.stringify({ p: c.placedAt.toISOString(), i: c.id.toString() })
    ).toString("base64url");

  const decodeCursor = (token) => {
    const { p, i } = JSON.parse(Buffer.from(token, "base64url").toString());
    // Revive the real types: the filter needs a Date and an ObjectId, not
    // the strings JSON gave us back.
    return { placedAt: new Date(p), id: new mongoose.Types.ObjectId(i) };
  };

  /**
   * One page of the order feed — exactly what GET /api/orders?cursor=...
   * would return. `after` is the encoded cursor from the previous response
   * (or null for page 1).
   */
  async function fetchOrderPage({ after = null, pageSize = PAGE_SIZE } = {}) {
    const filter = {};
    if (after) {
      const c = decodeCursor(after);
      filter.$or = [
        { placedAt: { $lt: c.placedAt } },
        { placedAt: c.placedAt, _id: { $lt: c.id } },
      ];
    }

    // THE limit+1 TRICK: ask for one row more than the page size. If it
    // shows up we KNOW a next page exists — without a count query — and we
    // simply do not return the probe row.
    const docs = await Order.find(filter)
      .sort(SORT)
      .limit(pageSize + 1)
      .select("orderNumber status totalAmount placedAt")
      .lean();

    const hasNextPage = docs.length > pageSize;
    const data = hasNextPage ? docs.slice(0, pageSize) : docs;
    const lastRow = data[data.length - 1];

    return {
      data,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && lastRow
            ? encodeCursor({ placedAt: lastRow.placedAt, id: lastRow._id })
            : null,
      },
    };
  }

  // Walk the first three pages like a scrolling client would, proving no
  // order ever appears twice.
  const seen = new Set();
  let token = null;
  for (let pageNo = 1; pageNo <= 3; pageNo++) {
    const { data, pageInfo } = await fetchOrderPage({ after: token });
    const dupes = data.filter((o) => seen.has(o.orderNumber));
    data.forEach((o) => seen.add(o.orderNumber));
    show(`Page ${pageNo}`, {
      orders: data.map((o) => o.orderNumber),
      duplicatesSeenBefore: dupes.length,
      hasNextPage: pageInfo.hasNextPage,
      nextCursor: pageInfo.nextCursor
        ? pageInfo.nextCursor.slice(0, 24) + "..."
        : null,
    });
    token = pageInfo.nextCursor;
    if (!pageInfo.hasNextPage) break;
  }
  show("Distinct orders across 3 pages", seen.size);
  note(
    "15 orders, 0 duplicates. The client's whole job: render data, keep " +
      "nextCursor, send it back for the next page, stop when hasNextPage " +
      "is false. The token is base64url — URL-safe, so it can ride in a " +
      "query string untouched."
  );

  // --------------------------------------------------------------------
  section("5. Cross-check: cursor page 2 === skip/limit page 2 (static data)");
  // On data that is NOT changing, both schemes must slice the same sorted
  // sequence identically. Comparing them is a great self-test for your
  // $or filter's correctness.
  const skipPage2 = await Order.find()
    .sort(SORT)
    .skip(PAGE_SIZE)
    .limit(PAGE_SIZE)
    .select("orderNumber")
    .lean();
  const sameOrders =
    skipPage2.length === page2.length &&
    skipPage2.every((o, i) => o.orderNumber === page2[i].orderNumber);
  show("skip/limit page 2 equals cursor page 2?", sameOrders);
  note(
    "They agree while the data stands still — the schemes only diverge " +
      "when writes happen mid-scroll, and then the CURSOR is the correct " +
      "one: a new order lands ABOVE our position in newest-first order, so " +
      "'strictly after the cursor' still returns exactly the unseen rows. " +
      "The skip version would shift and show a duplicate (lesson 03, " +
      "section 6)."
  );

  // --------------------------------------------------------------------
  section("6. Realistic variant: ONE user's order history");
  // 'My orders' pages are cursor pagination + a filter. Note our seeded
  // compound index { user: 1, placedAt: -1 } serves EXACTLY this pattern:
  // equality on user, then range/order on placedAt.
  const someOrder = await Order.findOne().sort(SORT).select("user").lean();
  const userId = someOrder.user;

  let userToken = null;
  for (let pageNo = 1; pageNo <= 2; pageNo++) {
    const filter = { user: userId };
    if (userToken) {
      const c = decodeCursor(userToken);
      filter.$or = [
        { placedAt: { $lt: c.placedAt } },
        { placedAt: c.placedAt, _id: { $lt: c.id } },
      ];
    }
    const docs = await Order.find(filter)
      .sort(SORT)
      .limit(3 + 1) // page size 3, +1 probe
      .select("orderNumber placedAt totalAmount")
      .lean();
    const hasNext = docs.length > 3;
    const data = hasNext ? docs.slice(0, 3) : docs;
    show(`User ${userId.toString().slice(-6)} — history page ${pageNo}`, {
      orders: data.map(brief),
      hasNextPage: hasNext,
    });
    if (!hasNext) break;
    const lastRow = data[data.length - 1];
    userToken = encodeCursor({ placedAt: lastRow.placedAt, id: lastRow._id });
  }
  note(
    "The user filter and the cursor filter combine into one query: " +
      "{ user, $or: [...] }. For a GLOBAL feed like sections 1-5, " +
      "production would add a { placedAt: -1, _id: -1 } index so the " +
      "cursor seek never scans — index design is module " +
      "12-indexes-and-performance."
  );

  // --------------------------------------------------------------------
  section("7. Trade-offs — what cursors give up");
  note(
    "Cursors CANNOT jump: there is no 'take me to page 7', only 'continue " +
      "after this position' — the one thing skip/limit does better. There " +
      "is also no free totalPages (run a separate countDocuments if the UI " +
      "needs 'about 1,240 results'), the cursor is welded to its exact " +
      "sort, and the code is a little longer. Rule of thumb: numbered " +
      "pager on calm, moderate data -> skip/limit; feed, infinite scroll, " +
      "export job, or anything large/busy -> cursor. Both stand on the " +
      "same foundation: a deterministic sort ending in _id."
  );
});
