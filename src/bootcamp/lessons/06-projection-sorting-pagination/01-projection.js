/**
 * LESSON 06-projection-sorting-pagination/01-projection — Choosing fields
 *
 * A projection tells MongoDB which FIELDS of each matching document to send
 * back. It is the difference between shipping a whole product document to
 * render a card that shows 4 fields — and shipping exactly those 4 fields.
 * This lesson covers include vs exclude mode, the _id exception, Mongoose's
 * .select() string and object syntaxes, nested fields, the $slice array
 * operator, a virtuals gotcha, and WHY projection matters (payload size and
 * security).
 *
 * 100% READ-ONLY on the seeded store data — safe to run any time.
 *
 * Run it with:  npm run lesson 06-projection-sorting-pagination/01-projection
 */
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

await runLesson("Projection — choosing which fields come back", async () => {
  // --------------------------------------------------------------------
  section("1. The problem: without projection you get EVERYTHING");
  // A plain find() returns every field of every matching document. Look at
  // how much one product really carries.
  const fullProduct = await Product.findOne({ isActive: true }).lean();
  show("One FULL product document", fullProduct);
  show("Fields in that document", Object.keys(fullProduct));
  note(
    "A listing page showing 24 product cards needs ~4 of these fields. " +
      "Fetching full documents means every extra field is paid for 24 times: " +
      "on the MongoDB server, on the network, and in JSON parsing."
  );

  // --------------------------------------------------------------------
  section("2. Inclusion mode — name the fields you WANT");
  // .select("name price") becomes the `projection` part of the find command.
  // The SERVER trims each document before it crosses the network — this is
  // not Mongoose deleting fields afterwards in Node.js.
  // (.lean() = plain objects, so the output below is EXACTLY what the
  // server sent back — nothing added by Mongoose.)
  const cards = await Product.find({ isActive: true })
    .select("name price")
    .limit(3)
    .lean();
  show("select('name price') — 3 product cards", cards);
  note(
    "Notice _id came along even though we never asked for it. _id is " +
      "included BY DEFAULT in every projection — clients almost always need " +
      "it (to link to the detail page, to update, to key React lists)."
  );

  // Object syntax does exactly the same: 1 = include. Use it when the field
  // list is built dynamically (e.g. from a ?fields= query parameter).
  const cardsAgain = await Product.find({ isActive: true })
    .select({ name: 1, price: 1 })
    .limit(1)
    .lean();
  show("Same projection, object syntax { name: 1, price: 1 }", cardsAgain);

  // find(filter, projection) — the projection as second argument — is a
  // third spelling of the same thing. All three send the same command.
  const viaSecondArg = await Product.find(
    { isActive: true },
    { name: 1, price: 1 }
  )
    .limit(1)
    .lean();
  show("Same again via find(filter, projection)", viaSecondArg);
  note(
    "String select, object select, and find()'s second argument are " +
      "interchangeable. Most codebases standardize on .select('...') for " +
      "readability."
  );

  // --------------------------------------------------------------------
  section("3. Dropping _id — the one exception to every rule");
  // _id is the only field you may EXCLUDE inside an inclusion projection.
  // Useful for pure display data where the client never references the doc.
  const anonymous = await Product.find({ isActive: true })
    .select("name price -_id")
    .limit(3)
    .lean();
  show("select('name price -_id')", anonymous);
  note(
    "Why is _id special? A mixed projection is normally ambiguous, but _id " +
      "has a known default (included) — so { name: 1, _id: 0 } has exactly " +
      "one sensible meaning and MongoDB allows it."
  );

  // --------------------------------------------------------------------
  section("4. Exclusion mode — name the fields you DON'T want");
  // The "-" prefix (or 0 in object syntax) flips the projection into
  // exclusion mode: keep everything EXCEPT these. Handy when you want "the
  // whole document minus one or two heavy/secret fields".
  const noDescription = await Product.findOne({ isActive: true })
    .select("-description -tags")
    .lean();
  show("select('-description -tags') keeps everything else", noDescription);
  note(
    "SECURITY is the classic use of exclusion: user routes exclude password " +
      "hashes, tokens, internal flags. Production schemas go one step " +
      "further with `select: false` on the secret field itself — then it is " +
      "excluded from EVERY query automatically, and only an explicit " +
      ".select('+password') (note the + prefix) can bring it back. " +
      "A rule nobody can forget beats a rule everyone must remember."
  );

  // --------------------------------------------------------------------
  section("5. You cannot mix include and exclude (except _id)");
  // What should { name: 1, stock: 0 } do with `price`, which is mentioned
  // nowhere? Include it (exclusion-mode thinking) or drop it (inclusion-mode
  // thinking)? The question has no answer, so MongoDB refuses the query.
  try {
    await Product.find({}, { name: 1, stock: 0 });
    show("Mixed projection", "no error?! (unexpected)");
  } catch (error) {
    show("Mixing { name: 1, stock: 0 } was rejected", {
      name: error.name,
      message: error.message,
    });
  }
  note(
    "This error comes back from the MongoDB SERVER, not from Mongoose. " +
      "Remember the rule as: a projection is either a want-list or a " +
      "don't-want-list — never both. Only _id may cross the line."
  );

  // --------------------------------------------------------------------
  section("6. Nested fields — dot notation reaches inside documents");
  // Embedded documents project with dot paths. Asking for "address.city"
  // returns an address object containing ONLY city.
  const cities = await User.find({ isActive: true })
    .select("name address.city")
    .limit(3)
    .lean();
  show("select('name address.city')", cities);
  note(
    "Users missing the whole address (~15% of seeds) simply come back " +
      "without an address key — projecting a missing field is not an error."
  );

  // The same works INSIDE arrays of subdocuments: project two fields of
  // every line item in an order. Perfect for an order-history screen that
  // shows "what did I buy" without prices and product ids.
  const orderSummaries = await Order.find()
    .select("orderNumber items.productName items.quantity")
    .limit(2)
    .lean();
  show("Line items trimmed to name + quantity", orderSummaries);

  // Exclusion works on nested paths too — but ONLY in pure exclusion mode:
  // "the whole product, minus the heavy text fields and one spec".
  const noWeight = await Product.findOne({ isActive: true })
    .select("-description -tags -specs.weightGrams -createdAt -updatedAt")
    .lean();
  show("Nested exclusion: -specs.weightGrams", noWeight);
  note(
    "The no-mixing rule applies to nested paths as well: " +
      "{ specs: 1, 'specs.weightGrams': 0 } counts as mixing include and " +
      "exclude and is rejected just like the flat version in section 5."
  );

  // --------------------------------------------------------------------
  section("7. $slice — projecting only PART of an array");
  // $slice is a projection OPERATOR: it limits how many ELEMENTS of an
  // array come back (here: just the first line item). Think "preview of a
  // long array" — e.g. show 2 of 500 comments on a listing page.
  const firstItemOnly = await Order.findOne({ status: "delivered" })
    .select({ items: { $slice: 1 } })
    .lean();
  show("Order with items sliced to 1 element", {
    orderNumber: firstItemOnly.orderNumber,
    items: firstItemOnly.items,
    totalAmount: firstItemOnly.totalAmount,
  });
  note(
    "Special behavior: $slice alone does NOT switch the projection into " +
      "inclusion mode — every other field is still returned; only the array " +
      "is shortened. Seeded orders have 1-4 items, so the effect is small " +
      "here, but on an array of thousands it is the difference between a " +
      "kilobyte and a megabyte."
  );

  // --------------------------------------------------------------------
  section("8. Gotcha: projections can silently break virtuals");
  // `finalPrice` is a VIRTUAL — computed in Node from price and
  // discountPercent. Virtuals do not know about projections: if you project
  // away an ingredient, the getter still runs, on undefined.
  const projected = await Product.findOne({ isActive: true }).select(
    "name sku"
  );
  show("Virtual on a projected doc", {
    name: projected.name,
    finalPrice: projected.finalPrice, // price is undefined -> NaN
  });
  note(
    "finalPrice is NaN, not an error — undefined * anything is NaN in " +
      "JavaScript, and nothing crashes until the NaN reaches your UI or a " +
      "calculation. Rule: select every field your virtuals read (here: " +
      "price and discountPercent), or use .lean() for pure display data and " +
      "skip virtuals entirely."
  );

  // The same silence applies to ordinary fields: a projected-away field
  // reads as undefined — no warning that YOU chose to drop it.
  show("Reading a projected-away field", {
    description: projected.description, // undefined, not an error
  });
  note(
    "Also: a document loaded with an inclusion projection is INCOMPLETE. " +
      "Treat it as read-only — modifying and .save()-ing partial documents " +
      "invites subtle bugs. Project for reads; for writes, load fully or " +
      "use update operators (module 07)."
  );

  // --------------------------------------------------------------------
  section("9. Why it matters: measuring the payload");
  // Fetch ALL products twice — full documents vs a 4-field card projection —
  // and compare the JSON payload a real API would send to the browser.
  const fullDocs = await Product.find().lean();
  const cardDocs = await Product.find()
    .select("name price discountPercent ratingSummary.average")
    .lean();

  const fullBytes = Buffer.byteLength(JSON.stringify(fullDocs));
  const cardBytes = Buffer.byteLength(JSON.stringify(cardDocs));
  show("Payload for all 63 products", {
    fullDocuments: `${fullBytes} bytes`,
    projectedCards: `${cardBytes} bytes`,
    saved: `${(100 - (cardBytes / fullBytes) * 100).toFixed(1)}%`,
  });
  note(
    "Same 63 documents, a fraction of the bytes — and the trimming happened " +
      "on the SERVER, so the network never carried the rest. Multiply by " +
      "every request from every user, and projection is one of the cheapest " +
      "performance (and security) wins a backend has. Doing the same with " +
      ".map() in Node would save NOTHING: the full docs already arrived."
  );

  // A realistic API response shape built from that projection — what a
  // GET /api/products listing endpoint would actually return per card.
  show("First projected card, as the API would send it", cardDocs[0]);
  note(
    "Next lesson: these cards come back in whatever order MongoDB likes. " +
      "sort() — 02-sorting — makes the order intentional."
  );
});
