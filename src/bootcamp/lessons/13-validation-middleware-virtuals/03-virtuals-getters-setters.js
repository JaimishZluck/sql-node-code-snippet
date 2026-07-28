/**
 * LESSON 13-validation-middleware-virtuals/03-virtuals-getters-setters
 *
 * Three related tools for the gap between "what is stored" and "what your
 * code and your API want to see":
 *
 *   VIRTUAL — a computed property that is NEVER stored. product.finalPrice
 *             is derived from price and discountPercent every time you read
 *             it, so it can never drift out of sync.
 *   GETTER  — transforms a stored value on the way OUT.
 *   SETTER  — transforms an assigned value on the way IN (before storage).
 *
 * Plus toJSON/toObject transforms — the standard way to hide internal fields
 * from API responses without touching a controller.
 *
 * Everything here runs in NODE.JS, inside Mongoose. MongoDB knows nothing
 * about any of it — which is exactly why virtuals cannot be queried or
 * sorted on. That limitation is the most important thing in this lesson.
 *
 * SAFE TO RE-RUN: writes only temporary documents (emails @lesson.test) and
 * a throwaway collection, all cleaned up. Seeded data is read-only here.
 *
 * Run it with:  npm run lesson 13-validation-middleware-virtuals/03-virtuals-getters-setters
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import Product from "../../../models/product.model.js";
import User from "../../../models/user.model.js";

const TEMP_COLLECTION = "tmp_virtuals_lab";

await runLesson("Validation, middleware, virtuals 3/3 — Virtuals", async () => {
  const db = mongoose.connection.db;
  await db.collection(TEMP_COLLECTION).drop().catch(() => {});
  await User.deleteMany({ email: /@lesson\.test$/ });

  // --------------------------------------------------------------------
  section("1. A virtual you already have — product.finalPrice");
  const product = await Product.findOne({ discountPercent: { $gte: 10 } });
  show("Reading a virtual", {
    name: product.name,
    price: product.price,
    discountPercent: product.discountPercent,
    "finalPrice (virtual, computed on read)": product.finalPrice,
  });

  // Prove it is not stored: look at the raw document through the driver.
  const raw = await db.collection("products").findOne({ _id: product._id });
  show("The same document, straight from MongoDB", {
    fieldsInTheDatabase: Object.keys(raw),
    "is finalPrice stored?": "finalPrice" in raw,
  });
  note(
    "finalPrice exists in Node.js and nowhere else. That is the point: if we " +
      "STORED it, then every price change or discount change would have to " +
      "remember to update it too, and one missed path means a product " +
      "displaying the wrong price forever. A virtual cannot drift because " +
      "there is nothing to drift."
  );

  // --------------------------------------------------------------------
  section("2. THE limitation — you cannot query or sort a virtual");
  const queryAttempt = await Product.find({ finalPrice: { $lt: 1000 } }).countDocuments();
  show("Trying to query a virtual", {
    "Product.find({ finalPrice: { $lt: 1000 } })": queryAttempt,
    why: "MongoDB has no finalPrice field, so the filter matches nothing",
  });

  // The workaround: compute the same thing in an aggregation, where the
  // SERVER can evaluate it.
  const viaAggregation = await Product.aggregate([
    {
      $addFields: {
        finalPrice: {
          $round: [{ $multiply: ["$price", { $subtract: [1, { $divide: ["$discountPercent", 100] }] }] }, 0],
        },
      },
    },
    { $match: { finalPrice: { $lt: 1000 } } },
    { $sort: { finalPrice: 1 } },
    { $limit: 5 },
    { $project: { _id: 0, name: 1, price: 1, discountPercent: 1, finalPrice: 1 } },
  ]);
  show("The same question, answered by the server", viaAggregation);
  note(
    "Rule: virtuals are for DISPLAY, not for querying. If users must filter " +
      "or sort by a derived value, you have three options: (a) compute it in " +
      "an aggregation pipeline like this; (b) STORE it as a real field and " +
      "keep it in sync with middleware (accepting the drift risk); or " +
      "(c) restructure so the stored field is the one people search by. " +
      "Choosing (b) prematurely is a common mistake — reach for (a) first."
  );

  // --------------------------------------------------------------------
  section("3. Virtuals do not appear in JSON unless you opt in");
  const withoutOptIn = new mongoose.Schema({ first: String, last: String });
  withoutOptIn.virtual("fullName").get(function () {
    return `${this.first} ${this.last}`;
  });
  const Plain = mongoose.models.LessonPlain
    ?? mongoose.model("LessonPlain", withoutOptIn, TEMP_COLLECTION);
  const plain = new Plain({ first: "Asha", last: "Menon" });

  show("Default behaviour", {
    "doc.fullName (property access)": plain.fullName,
    "JSON.parse(JSON.stringify(doc))": JSON.parse(JSON.stringify(plain)),
    "is fullName in the JSON?": "fullName" in JSON.parse(JSON.stringify(plain)),
  });
  show("Our Product model opts in", {
    schemaOptions: "toJSON: { virtuals: true }, toObject: { virtuals: true }",
    "finalPrice in JSON": "finalPrice" in product.toJSON(),
    "note the extra `id` field": product.toJSON().id !== undefined,
  });
  note(
    "Without { virtuals: true }, res.json(product) silently omits every " +
      "virtual and your frontend gets undefined. Opting in also exposes " +
      "Mongoose's built-in `id` virtual (a string version of _id), which is " +
      "often handy for clients that dislike ObjectIds."
  );

  // --------------------------------------------------------------------
  section("4. Getters — transform on the way out");
  const moneySchema = new mongoose.Schema({
    label: String,
    // Store paise (integers, exact); present rupees.
    amountPaise: {
      type: Number,
      get: (paise) => (typeof paise === "number" ? paise / 100 : paise),
    },
    tag: { type: String, get: (v) => (v ? v.toUpperCase() : v) },
  }, { toJSON: { getters: true }, toObject: { getters: true } });

  const Money = mongoose.models.LessonMoney
    ?? mongoose.model("LessonMoney", moneySchema, TEMP_COLLECTION);
  const money = new Money({ label: "Refund", amountPaise: 149900, tag: "settled" });

  show("Getter output", {
    "doc.amountPaise (getter applied)": money.amountPaise,
    "the raw stored value": money.get("amountPaise", null, { getters: false }),
    "doc.tag": money.tag,
  });
  note(
    "Getters are useful for units and formatting, but be careful: the getter " +
      "applies on READ, so this.amountPaise inside your own code is already " +
      "divided. Writing `doc.amountPaise = doc.amountPaise` would then halve " +
      "your value... twice over. Getters also do NOT apply in queries — " +
      "find({ amountPaise: 1499 }) searches for 1499 paise, not 1499 rupees. " +
      "Most teams avoid getters for exactly this reason and format in the " +
      "response layer instead."
  );

  // --------------------------------------------------------------------
  section("5. Setters — transform on the way in");
  // Our real User schema already uses the declarative shortcuts.
  const user = new User({ name: "  Ravi Iyer  ", email: "  RAVI@LESSON.TEST " });
  show("Built-in setters on the User schema", {
    "name (trim: true)": `"${user.name}"`,
    "email (lowercase + trim)": `"${user.email}"`,
  });

  // A custom setter for normalizing input.
  const phoneSchema = new mongoose.Schema({
    phone: {
      type: String,
      // Strip everything that is not a digit, then keep the last 10.
      set: (value) => (typeof value === "string" ? value.replace(/\D/g, "").slice(-10) : value),
    },
  });
  const Phone = mongoose.models.LessonPhone
    ?? mongoose.model("LessonPhone", phoneSchema, TEMP_COLLECTION);
  show("Custom setter normalizing messy input", {
    '"+91 98765-43210"': new Phone({ phone: "+91 98765-43210" }).phone,
    '"(022) 9876543210"': new Phone({ phone: "(022) 9876543210" }).phone,
  });
  note(
    "Setters run BEFORE validation and before storage, so the validator sees " +
      "the cleaned value — that ordering is what makes them useful. Unlike " +
      "getters, setters DO apply to query values by default, so " +
      "find({ phone: '+91 98765-43210' }) correctly finds '9876543210'. " +
      "Setters are generally safer than getters."
  );

  // --------------------------------------------------------------------
  section("6. Virtual setters");
  const nameSchema = new mongoose.Schema({ first: String, last: String });
  nameSchema
    .virtual("fullName")
    .get(function () {
      return [this.first, this.last].filter(Boolean).join(" ");
    })
    // A virtual can have a setter too: assigning to it distributes the value
    // across the real fields.
    .set(function (value) {
      const [first, ...rest] = String(value).trim().split(/\s+/);
      this.first = first;
      this.last = rest.join(" ");
    });
  const Person = mongoose.models.LessonPerson
    ?? mongoose.model("LessonPerson", nameSchema, TEMP_COLLECTION);

  const person = new Person();
  person.fullName = "Priya Raman Nair";
  show("Assigning to a virtual", { first: person.first, last: person.last, fullName: person.fullName });

  // --------------------------------------------------------------------
  section("7. toJSON transforms — shaping every API response");
  // The cleanest place to hide internal fields, applied automatically
  // wherever res.json(doc) is called.
  const apiSchema = new mongoose.Schema(
    {
      email: String,
      passwordHash: String,
      internalNotes: String,
      name: String,
    },
    {
      toJSON: {
        virtuals: true,
        // `transform` runs last, receiving the plain object. Mutate and
        // return it.
        transform(doc, ret) {
          delete ret.passwordHash;
          delete ret.internalNotes;
          delete ret.__v;
          ret.id = ret._id?.toString();
          delete ret._id;
          return ret;
        },
      },
    }
  );
  const ApiUser = mongoose.models.LessonApiUser
    ?? mongoose.model("LessonApiUser", apiSchema, TEMP_COLLECTION);

  const apiUser = new ApiUser({
    email: "api@lesson.test",
    passwordHash: "$2b$10$notarealhash",
    internalNotes: "flagged for review",
    name: "API Demo",
  });
  show("Raw document fields", Object.keys(apiUser.toObject()));
  show("What res.json() would actually send", apiUser.toJSON());
  note(
    "The secrets never reach the response, and no controller had to remember " +
      "to strip them. This is the right layer for it: a transform applies " +
      "everywhere the document is serialized, including nested populated " +
      "documents. Compare with `select: false` on the schema field, which " +
      "stops the value being LOADED at all — stronger, but then you must opt " +
      "in with .select('+passwordHash') when you genuinely need it (for a " +
      "login check)."
  );

  // --------------------------------------------------------------------
  section("8. The lean() interaction");
  const hydrated = await Product.findById(product._id);
  const leaned = await Product.findById(product._id).lean();
  show("Virtuals and lean()", {
    "hydrated doc .finalPrice": hydrated.finalPrice,
    "lean() object .finalPrice": leaned.finalPrice,
    why: "lean() returns a plain object — no schema machinery is attached",
  });
  note(
    "This catches people constantly: adding .lean() to speed up an endpoint " +
      "silently removes every virtual, getter, and toJSON transform from the " +
      "response. If you need both, either compute the value in an " +
      "aggregation, or use the mongoose-lean-virtuals plugin, or drop " +
      ".lean() for that particular query."
  );

  // --------------------------------------------------------------------
  section("9. Choosing between virtual, stored field, and aggregation");
  show("Decision guide", {
    "virtual": "cheap to compute, display only, never filtered/sorted on. e.g. finalPrice, fullName, isDeleted",
    "stored field + middleware":
      "needs to be queried, sorted, or indexed — accept the sync burden. e.g. a search slug",
    "aggregation $addFields":
      "needed occasionally for reports/filters, but not worth storing. e.g. revenue per order",
    "instance method": "an action rather than a value. e.g. user.comparePassword(x)",
    "static method": "an operation on the collection. e.g. User.findActiveAdmins()",
  });

  // --------------------------------------------------------------------
  section("10. Cleanup");
  await db.collection(TEMP_COLLECTION).drop().catch(() => {});
  await User.deleteMany({ email: /@lesson\.test$/ });
  show("Cleanup", { dropped: TEMP_COLLECTION });
  note(
    "Module 13 complete. Next: module 14 — transactions and concurrency, " +
      "where multiple writes must succeed or fail together."
  );
});
