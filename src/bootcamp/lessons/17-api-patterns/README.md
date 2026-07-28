# Module 17 — API patterns: everything, as a real Express API

Sixteen modules of MongoDB, assembled into something you can actually hit with
a browser.

```bash
npm run bootcamp:api
# → http://localhost:4100
```

Then open [http://localhost:4100](http://localhost:4100) for an index of every
endpoint, or jump straight to:

```
http://localhost:4100/api/products?minPrice=1000&sort=price-desc
http://localhost:4100/api/products/search?q=wireless
http://localhost:4100/api/dashboard/summary
```

This module has **no lesson scripts**. The code *is* the lesson — read it
alongside this chapter. It lives in [src/bootcamp/api/](../../api/):

```
api/
  server.js              app setup, health check, graceful shutdown
  products.routes.js     filtering, sorting, pagination, text search, detail
  orders.routes.js       cursor pagination, and a stock-safe write path
  dashboard.routes.js    aggregation-powered reports
  lib/helpers.js         asyncHandler, ApiError, id validation, pagination
  lib/error.middleware.js  every error type → the right HTTP status
```

It is deliberately separate from the repo's main app (`src/index.js`) and has
no auth, rate limiting, or logging middleware — those are the main template's
job. Here nothing competes with the database patterns for your attention.

## The endpoints

| Method | Path | Demonstrates |
| --- | --- | --- |
| `GET` | `/api/products` | filter building, allow-listed sort, skip/limit pagination + total, `select`, `populate`, `lean` |
| `GET` | `/api/products/search?q=` | `$text`, `$meta: "textScore"`, `$facet` for sidebar counts, `$bucket` |
| `GET` | `/api/products/:id` | id validation, `.orFail()` → 404, parallel queries, denormalized `ratingSummary` |
| `GET` | `/api/orders` | **cursor pagination** with `nextCursor` |
| `GET` | `/api/orders/:id` | nested `populate` |
| `POST` | `/api/orders` | request validation, `$in` batch load, **conditional stock update**, snapshots, transactions with a standalone fallback |
| `GET` | `/api/dashboard/summary` | `$facet` — five reports, one round trip |
| `GET` | `/api/dashboard/top-products` | `$unwind` + `$group` + `$lookup` |
| `GET` | `/api/dashboard/customers` | filtering parents by a **joined** field |
| `GET` | `/api/dashboard/catalogue` | `$bucket`, `$facet`, parallel pipelines |
| `GET` | `/health` | reports the **database** state, not just the process |

**Safety:** every endpoint except `POST /api/orders` is read-only. `POST
/api/orders` creates a real order and decrements real stock — that is the
point of it. Run `npm run db:seed` whenever you want the seeded state back.

---

## Topic: The list endpoint

**What is it?** `GET /api/products` — filter from query parameters, sort,
paginate, and return the page plus metadata.

**Why does it exist?** (what problem it solves) It is the single most common
endpoint in any backend, and the single most common place to leak performance
and security problems.

**When should I use this shape?** Whenever a client needs a browsable
collection: catalogues, admin tables, search results.

**When should I avoid it?** When the result set is unbounded and the client
scrolls infinitely — then use cursor pagination (`GET /api/orders`). And when
one client needs everything, use a cursor/export job, never a list endpoint
with a huge `limit`.

**Important terms**
- **Filter building** — turning `req.query` into a MongoDB filter. Every value
  arrives as a **string**; numbers must be converted.
- **Sort allow-list** — a fixed map from a URL value to a sort object.
  Passing raw user input into `.sort()` lets a client force an unindexed sort
  that can fail above 32 MB.
- **`limit` cap** — always. `?limit=999999999` must not be honoured.
- **Response envelope** — `{ data, meta }` so every list endpoint looks the
  same and clients can share pagination code.

**Code example** — `products.routes.js`:

```js
const [items, total] = await Promise.all([
  Product.find(filter)
    .select("name sku price stock ratingSummary category")  // trim the payload
    .sort(sort).skip(skip).limit(limit)
    .populate("category", "name slug")                       // 1 extra query, not N
    .lean(),                                                 // no hydration
  Product.countDocuments(filter),                            // SAME filter object
]);
```

**Expected result** — `{ data: [...], meta: { page, limit, total, totalPages,
hasNextPage, hasPrevPage } }`. With the seeded data,
`/api/products?minPrice=1000&sort=price-desc` returns the most expensive
products first, 20 per page.

**Common mistakes**
- **Two different filter objects** for the query and the count. They drift,
  and your `totalPages` is silently wrong.
- **Awaiting the two queries sequentially.** They are independent — use
  `Promise.all`.
- **No `limit` cap.** One request can exhaust memory.
- **Raw `sort` from the query string.** Unindexed sorts, and information
  disclosure about your schema.
- **Returning full documents.** A 2,000-character description × 20 products
  per page is wasted bandwidth on every request.
- **Forgetting that `.lean()` removes virtuals.** `finalPrice` must then be
  computed in the map, as this route does.

**Real-world usage** — every product listing, admin table, and search result
page you will ever build.

**Related concepts** — [module 06](../06-projection-sorting-pagination/README.md),
[module 10](../10-populate-and-lean/README.md),
[module 12](../12-indexes-and-performance/README.md).

---

## Topic: Cursor pagination

**What is it?** Instead of "page 7", the client sends back the last id it saw:
`GET /api/orders?after=<id>&limit=20`.

**Why does it exist?** (what problem it solves) Two problems with
`skip`/`limit`. **Cost**: `skip(20000)` makes the server walk past 20,000
documents every time, so deep pages get linearly slower. **Correctness**: if a
new order arrives while the user is on page 2, everything shifts and they see
a duplicate — or miss one entirely.

**When should I use it?** Infinite scroll, public APIs, exports, activity
feeds, anything unbounded.

**When should I avoid it?** When users genuinely need to jump to page 7 —
cursors cannot do that. Admin tables with modest data are fine with
`skip`/`limit`.

**Important terms**
- **Cursor** — an opaque token. Here it is the last `_id`; in general it must
  be a **unique**, **stably-ordered** field.
- **`hasMore`** — computed by fetching `limit + 1` documents and checking
  whether the extra one exists. Cheaper than a separate count.
- **Tie-breaking** — sorting by a non-unique field (`placedAt`) needs `_id` as
  a secondary sort, or documents sharing a timestamp can be skipped or
  repeated.

**Code example** — `orders.routes.js`:

```js
if (req.query.after) filter._id = { $lt: requireObjectId(req.query.after) };

const items   = await Order.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
const hasMore = items.length > limit;
const page    = hasMore ? items.slice(0, limit) : items;

res.json({ data: page, meta: { hasMore, nextCursor: hasMore ? String(page.at(-1)._id) : null } });
```

**Expected result** — `nextCursor` on the first response; passing it as
`?after=` returns the next 20 orders with no overlap, at constant cost.

**Common mistakes**
- **Sorting by a non-unique field with no tie-breaker.** Silent duplicates.
- **Exposing an internal cursor the client can tamper with** without
  validating it — `requireObjectId` matters here.
- **Mixing cursor and page-number pagination** in one API. Pick one per
  endpoint and be consistent.

**Related concepts** — [module 06](../06-projection-sorting-pagination/README.md),
[module 12](../12-indexes-and-performance/README.md).

---

## Topic: The write path — placing an order

**What is it?** `POST /api/orders`. The most interesting code in the module:
validate the request, batch-load products, decrement stock safely, snapshot
prices, and create the order.

**Why does it exist?** (what problem it solves) It is where concurrency stops
being theoretical. Two customers buying the last unit at the same moment must
not both succeed.

**The four patterns it uses**

**1. Validate before touching the database.**

```js
const parsedUserId = requireObjectId(userId, "userId");   // 400, not a 500 CastError
if (!Array.isArray(items) || items.length === 0) throw new ApiError("items required", 400);
```

**2. Batch-load, never loop.**

```js
const products = await Product.find({ _id: { $in: productIds } }).lean();
const byId = new Map(products.map(p => [String(p._id), p]));
```

One query for every product, not one per line item — the N+1 fix from module
12.

**3. The precondition goes in the FILTER.**

```js
const result = await Product.updateOne(
  { _id: product._id, stock: { $gte: item.quantity } },   // ← the check
  { $inc: { stock: -item.quantity } }                     // ← the change
);
if (result.matchedCount === 0) throw new ApiError("Insufficient stock", 409);
```

Check and change happen inside **one atomic server operation**, so no two
buyers can both pass the check. Reading `product.stock` and deciding in
JavaScript would let exactly that happen.

**4. Snapshot what the customer paid.**

```js
const unitPrice = Math.round(product.price * (1 - product.discountPercent / 100));
lineItems.push({ product: product._id, productName: product.name, unitPrice, quantity, subtotal });
```

An invoice must show the price at purchase time, even if the product is
renamed or repriced next week. Deliberate duplication (module 09).

**Transactions, with an honest fallback.** If the server is a replica set, the
whole thing runs inside `session.withTransaction(...)` so a failure on line
item 3 rolls back the decrements for items 1 and 2. On a standalone server the
route still works and still cannot oversell — each decrement is atomic on its
own — but it loses all-or-nothing across line items. The route says so in its
comments and reports `meta.transactional` in the response.

**Common mistakes**
- **`if (product.stock >= qty) await decrement()`.** Twelve requests pass the
  `if` before any of them writes.
- **Ignoring `matchedCount`.** You have no idea whether your conditional
  update applied.
- **Storing a reference to the price instead of a copy.** Old invoices then
  show today's price.
- **`Model.create(doc, { session })`.** Use the array form.
- **No idempotency.** A retried HTTP request places a second order. A
  client-supplied key on a unique index fixes it.
- **Trusting `userId` from the body in a real app.** It should come from the
  authenticated session — this API has no auth precisely so the database
  patterns stay visible.

**Related concepts** — [module 14](../14-transactions-and-concurrency/README.md),
[module 07](../07-updates-and-deletes/README.md),
[module 09](../09-data-modeling/README.md).

---

## Topic: Aggregation behind an endpoint

**What is it?** Dashboard routes that answer analytical questions in one round
trip.

**Why does it exist?** (what problem it solves) A dashboard needs five numbers
from the same filtered set. Five endpoints means five round trips and five
passes over the same documents; `$facet` does it once.

**When should I use it?** Admin dashboards, analytics endpoints, faceted
search sidebars, and any response combining a page of data with aggregate
counts.

**When should I avoid it?** When the numbers are expensive and read
constantly — then compute them on a schedule and store them (`$merge` into a
summary collection), or cache the response. A dashboard query scanning 50
million orders on every page load will not survive contact with production.

**Code example** — `dashboard.routes.js`:

```js
{ $match: { status: { $in: REVENUE_STATUSES } } },   // evaluated ONCE, shared
{ $facet: {
    totals:         [{ $group: { _id: null, revenue: { $sum: "$totalAmount" } } }],
    monthlyTrend:   [{ $group: { _id: { $dateTrunc: { date: "$placedAt", unit: "month" } }, ... } }],
    byPaymentMethod:[{ $sortByCount: "$payment.method" }],
    byStatus:       [...],
    largestOrders:  [{ $sort: { totalAmount: -1 } }, { $limit: 5 }],
} }
```

**Expected result** — one JSON document with five independent reports.
`REVENUE_STATUSES` is defined once at the top of the file, so no two endpoints
can quietly disagree about what "revenue" means.

**Common mistakes**
- **Forgetting facet results are arrays.** `summary.totals.revenue` is
  `undefined`; you need `summary.totals[0]`.
- **`$bucket` without `default`.** Works until someone adds an expensive
  product, then errors in production.
- **Summing a parent field after `$unwind`.** Revenue inflated by the average
  line-item count.
- **Defining "revenue" differently in two endpoints.** The numbers disagree,
  and someone spends a day finding out why.
- **No cache and no limit on an expensive dashboard query.**

**Related concepts** — [module 11](../11-aggregation/README.md),
[module 12](../12-indexes-and-performance/README.md).

---

## Topic: Errors, and the shape of a response

**What is it?** One error middleware ([lib/error.middleware.js](../../api/lib/error.middleware.js))
that maps every error type to a status. Controllers **throw**; they never build
error responses.

**Why does it exist?** (what problem it solves) Per-controller error handling
means every new controller is a chance to forget, and inconsistent responses
mean the frontend needs a special case per endpoint.

**Important terms**
- **`asyncHandler`** — Express 4 does not forward errors thrown from async
  handlers, so an unhandled rejection becomes a **hung request**. Every async
  route is wrapped. (Express 5 does this automatically.)
- **`ApiError`** — our own error carrying its HTTP status, for deliberate
  failures like "Insufficient stock" (409).
- **Four-argument signature** — Express identifies an error handler by its
  arity. Dropping the unused `next` silently turns it into ordinary
  middleware that never runs.
- **Middleware order** — real routes, then the 404 handler, then the error
  handler **last**.

**Code example** — the mapping:

| Error | Status |
| --- | --- |
| `ApiError` | its own `status` |
| `ValidationError` | 400, with a field-keyed `errors` object |
| `CastError` | 400 |
| code `11000` | 409, naming the field from `keyPattern` |
| `DocumentNotFoundError` | 404 |
| `VersionError` | 409 |
| `MongooseServerSelectionError` / `MongoNetworkError` | 503 |
| anything else | 500, logged in full, **message not sent to the client** |

**Common mistakes**
- **Missing `asyncHandler` on one route.** That route hangs instead of
  erroring — and it will be the one you did not test.
- **Sending `error.message` for unknown errors.** Leaks index names, schema
  paths, and sometimes connection strings.
- **Not logging what you hide.** You have traded a bad user experience for no
  debugging information.
- **Registering the error handler before the routes.** It never runs.

**Related concepts** — [module 15](../15-errors-and-query-behavior/README.md),
[module 13](../13-validation-middleware-virtuals/README.md).

---

## Topic: Health checks and graceful shutdown

**What is it?** `/health` reports the **database** connection state, and
SIGINT/SIGTERM handlers drain in-flight requests before closing the pool.

**Why do they exist?** A health check that only proves the process is alive
will happily keep an instance in the load balancer while it cannot reach
MongoDB. And an abrupt exit truncates in-flight responses and strands
connections on the server — multiplied by every pod in a rolling deploy.

**Code example** — `server.js`:

```js
app.get("/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;   // 1 = connected
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "degraded" });
});

const shutdown = async (signal) => {
  if (shuttingDown) return;                    // guard against a second Ctrl+C
  shuttingDown = true;
  setTimeout(() => process.exit(1), 10_000).unref();   // hard deadline
  server.close(async () => {                   // 1. stop accepting requests
    await disconnectDB();                      // 2. THEN close the pool
    process.exit(0);
  });
};
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

**Common mistakes**
- **`await connectDB()` after `listen()`.** The first requests race the
  handshake and hit Mongoose's buffering timeout.
- **Closing the pool before the server.** In-flight requests fail with
  "Client must be connected".
- **Handling only SIGINT.** Docker and Kubernetes send **SIGTERM** — your
  container never shuts down gracefully in production.
- **No hard deadline.** One stuck request blocks the exit until the
  orchestrator SIGKILLs you — the abrupt death you were avoiding.
- **No double-signal guard.** A second Ctrl+C re-enters the handler.

**Related concepts** — [module 02](../02-connections/README.md),
[module 18](../18-production-and-security/README.md).

---

## Check yourself

1. Why must `sort` come from an allow-list rather than straight from
   `req.query`?
2. Why are the list query and the count query given the *same* filter object,
   and why `Promise.all`?
3. What breaks if you add `.lean()` to a route that returns `finalPrice`?
4. Explain why `{ _id, stock: { $gte: qty } }` in the **filter** is safe and
   `if (product.stock >= qty)` is not.
5. Why does the order store `productName` and `unitPrice` instead of just the
   product reference?
6. What does `asyncHandler` prevent, and what happens on a route that forgets
   it?
7. Your `/health` returns 200 but every request 500s. What is the check
   missing?
8. In `shutdown`, why must `server.close()` come before `disconnectDB()`?

**Next:** [module 18 — Production & security](../18-production-and-security/README.md),
the last module: injection, secrets, replica sets, and sharding.
