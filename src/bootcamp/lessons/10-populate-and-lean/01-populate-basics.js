/**
 * LESSON 10-populate-and-lean/01-populate-basics — References & populate()
 *
 * An order stores WHO placed it as a bare ObjectId. This lesson shows what
 * that reference really is (plain data — MongoDB enforces nothing about it),
 * and what populate() really does with it: a SECOND query using $in, run by
 * Mongoose in Node, stitched into the parents in memory. It is NOT a join.
 * We watch both queries live with debug mode, then rebuild populate by hand
 * so the mechanics stick. Then: populate + select, populating refs inside a
 * subdocument array, multiple populates, and document-level populate.
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 10-populate-and-lean/01-populate-basics
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Order from "../../../models/order.model.js";
import User from "../../../models/user.model.js";

await runLesson("Populate basics — following references", async () => {
  // --------------------------------------------------------------------
  section("1. A reference is just an ObjectId — nothing more");
  // The Order schema declares:  user: { type: ObjectId, ref: "User" }.
  // In the DATABASE only the ObjectId exists. `ref` is Mongoose-only
  // metadata: it tells populate() which MODEL to query later. MongoDB has
  // no foreign keys — it does not know (or care) what this id points at.
  const rawOrder = await Order.findOne({ status: "delivered" }).select(
    "orderNumber user totalAmount"
  );
  show("Order fresh from the database (no populate)", rawOrder);
  show("What is order.user, exactly?", {
    value: String(rawOrder.user),
    isObjectId: rawOrder.user instanceof mongoose.Types.ObjectId,
    hasNameField: rawOrder.user.name, // undefined — it is an id, not a user
  });
  note(
    "order.user is a bare ObjectId. The name/email live in the users " +
      "collection. And because MongoDB enforces NOTHING about references, " +
      "you could store any ObjectId here — a product id, a random id — and " +
      "the insert would succeed. Referential integrity is YOUR app's job " +
      "(one reason soft-delete beats hard-delete: no dangling refs)."
  );

  // --------------------------------------------------------------------
  section("2. populate('user') — the id becomes the document");
  // Same order, but we ask Mongoose to follow the reference. After this,
  // order.user is a full User document instead of an id.
  const populated = await Order.findOne({ _id: rawOrder._id })
    .select("orderNumber user totalAmount")
    .populate("user");
  show("Same order, populated", {
    orderNumber: populated.orderNumber,
    totalAmount: populated.totalAmount,
    user: {
      _id: String(populated.user._id),
      name: populated.user.name,
      email: populated.user.email,
      role: populated.user.role,
    },
  });
  note(
    "One-to-one populate: one parent, one child. Had the referenced user " +
      "been deleted (a dangling ref), populate would set user to null — " +
      "no error, no warning. Production code always handles that null."
  );

  // --------------------------------------------------------------------
  section("3. What populate ACTUALLY does — watch the two queries");
  // mongoose.set('debug', true) prints every command Mongoose sends to the
  // server. Watch closely: populate is TWO commands, not one.
  //   #1  orders.find(...)                          <- the parents
  //   #2  users.find({ _id: { $in: [ ...ids ] } })  <- ONE query for ALL ids
  // Query #2 is built by Mongoose IN NODE from the ids it found in #1, and
  // the results are stitched into the orders in Node's memory. The MongoDB
  // server never performs a join here. (The server-side join is $lookup, an
  // aggregation stage — end of lesson 02.)
  mongoose.set("debug", true);
  await Order.find()
    .sort({ placedAt: -1 })
    .limit(3)
    .select("orderNumber user")
    .populate({ path: "user", select: "name" });
  mongoose.set("debug", false);
  note(
    "Above this note you can see both commands. Things to notice: (a) the " +
      "second command targets the users collection with $in; (b) ids are " +
      "BATCHED — 3 orders still cost exactly ONE user query, not 3; (c) " +
      "duplicate ids are sent once. Cost model: one extra round trip per " +
      "populated PATH, regardless of how many parents you fetched."
  );

  // --------------------------------------------------------------------
  section("4. Populate by hand — proof that it is not a join");
  // Everything populate does, in 4 visible steps. If you can write this,
  // you understand populate completely.
  const orders = await Order.find()
    .sort({ placedAt: -1 })
    .limit(5)
    .select("orderNumber user totalAmount")
    .lean(); // plain objects (full story in lesson 03)

  // Step 1: collect the referenced ids — de-duplicated, exactly like
  // populate does (two orders by the same user -> one id).
  const userIds = [...new Set(orders.map((o) => String(o.user)))];

  // Step 2: ONE second query with $in — "users whose _id is any of these".
  const users = await User.find({ _id: { $in: userIds } })
    .select("name email")
    .lean();

  // Step 3: index the children by id for O(1) lookup while stitching.
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  // Step 4: stitch — attach each child to its parent, in Node memory.
  // ?? null mirrors populate: a missing/dangling ref becomes null.
  const stitched = orders.map((o) => ({
    ...o,
    user: usersById.get(String(o.user)) ?? null,
  }));

  show("Hand-made populate (5 orders)", stitched.slice(0, 2));
  show("How many ids did the $in carry?", {
    ordersFetched: orders.length,
    distinctUserIds: userIds.length,
  });
  note(
    "This IS populate: find parents -> collect ids -> one $in query -> " +
      "stitch by id in memory. Two consequences worth engraving: the two " +
      "queries are NOT one atomic snapshot (data can change in between), " +
      "and populate can never filter the PARENTS by child fields — the " +
      "parents were already fetched before the child query existed."
  );

  // --------------------------------------------------------------------
  section("5. populate with select — fetch only what the screen shows");
  // The select option becomes the PROJECTION of query #2 (module 06!): the
  // server trims each user before it crosses the network. Without it you
  // ship whole user documents (address, interests, loyaltyPoints,
  // timestamps...) just to print a name — wasted bytes, and a security
  // risk the day the schema grows a sensitive field.
  const trimmed = await Order.find()
    .sort({ placedAt: -1 })
    .limit(3)
    .select("orderNumber totalAmount user")
    .populate({ path: "user", select: "name email" });
  show(
    "Orders with user trimmed to name + email",
    trimmed.map((o) => ({
      orderNumber: o.orderNumber,
      totalAmount: o.totalAmount,
      user: o.user, // only _id, name, email survived the projection
    }))
  );
  note(
    "Rule: EVERY populate gets a select. The string 'user', 'name email' " +
      "shorthand — .populate('user', 'name email') — does the same thing. " +
      "_id tags along by default, exactly as in module 06."
  );

  // --------------------------------------------------------------------
  section("6. Populating refs inside a subdocument array (items.product)");
  // Each order embeds items: [{ product: <ObjectId ref>, productName,
  // unitPrice, quantity, subtotal }]. The path "items.product" tells
  // populate to collect product ids across ALL items of ALL fetched orders
  // — still ONE $in query for everything.
  const orderWithProducts = await Order.findOne({ status: "delivered" })
    .select("orderNumber items totalAmount")
    .populate({ path: "items.product", select: "name sku price isActive" });

  show(
    "Line items: snapshot vs live product",
    orderWithProducts.items.map((item) => ({
      snapshotName: item.productName, // frozen at purchase time
      snapshotUnitPrice: item.unitPrice, // discount already applied, frozen
      quantity: item.quantity,
      liveProduct: item.product
        ? {
            name: item.product.name,
            sku: item.product.sku,
            currentPrice: item.product.price,
            stillActive: item.product.isActive,
          }
        : null, // dangling ref -> populate leaves null
    }))
  );
  note(
    "Notice the snapshot/live split: unitPrice (what the customer PAID) can " +
      "differ from the product's current price — that is why the order " +
      "stores snapshots at all. Populate gives you the LIVE product, for " +
      "things like 'is it still sold?' or linking to today's product page. " +
      "An invoice should read the snapshots, never the populated data."
  );

  // --------------------------------------------------------------------
  section("7. Multiple populates — one extra query per path");
  // Chaining .populate() twice populates two independent paths. Total
  // queries here: 1 (orders) + 1 (users $in) + 1 (products $in) = 3.
  // An array also works:  .populate([{ path: "user", ... }, { ... }]).
  const fullOrder = await Order.findOne({ status: "delivered" })
    .select("orderNumber user items totalAmount placedAt")
    .populate({ path: "user", select: "name email address.city" })
    .populate({ path: "items.product", select: "name sku" });

  show("Order detail as an API would send it", {
    orderNumber: fullOrder.orderNumber,
    placedAt: fullOrder.placedAt,
    totalAmount: fullOrder.totalAmount,
    customer: fullOrder.user,
    items: fullOrder.items.map((i) => ({
      product: i.product, // populated: { _id, name, sku }
      quantity: i.quantity,
      subtotal: i.subtotal,
    })),
  });
  note(
    "This shape — order + customer + live products — is the classic " +
      "GET /api/orders/:id response. Each populated path costs one round " +
      "trip, so populate only the paths this screen actually renders."
  );

  // --------------------------------------------------------------------
  section("8. Document-level populate — after the fact");
  // You can also populate a document you ALREADY have. Same mechanics
  // (a $in query + stitch), just triggered from the document. Since
  // Mongoose 6 you simply await it (the old .execPopulate() is gone).
  const lateOrder = await Order.findOne().select("orderNumber user");
  show("Before: user is an id", String(lateOrder.user));
  await lateOrder.populate({ path: "user", select: "name role" });
  show("After document.populate()", {
    orderNumber: lateOrder.orderNumber,
    user: lateOrder.user,
  });
  note(
    "Useful when a condition decides late whether the relation is needed. " +
      "One more fact for the road: a populated path SAVES as just the id — " +
      "Mongoose stores order.user._id, never the embedded user document, so " +
      "populating cannot accidentally turn a reference into an embed. " +
      "Next: 02-populate-advanced — deep populate, virtual populate, the " +
      "match trap, N+1, and when $lookup beats populate."
  );
});
