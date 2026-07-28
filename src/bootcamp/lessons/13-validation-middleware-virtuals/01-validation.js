/**
 * LESSON 13-validation-middleware-virtuals/01-validation — Guarding your data
 *
 * A schema without validation is just documentation. Validation is what
 * actually stops bad data from reaching the database — and understanding
 * WHERE each rule runs is the whole lesson:
 *
 *   - Mongoose validators run in NODE.JS, before the write leaves your app.
 *     They give friendly, per-field error messages. They can be bypassed by
 *     anything that writes to MongoDB without going through your models.
 *   - Unique indexes run in MONGODB. They are a real guarantee that holds for
 *     every writer — but they surface as error code 11000, not a
 *     ValidationError.
 *
 * SAFE TO RE-RUN: every write uses temporary documents (emails ending
 * @lesson.test, SKUs starting ZZ-) which are deleted at the start and end.
 * Seeded data is never modified.
 *
 * Run it with:  npm run lesson 13-validation-middleware-virtuals/01-validation
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";
import Order from "../../../models/order.model.js";

/** Run something that should fail, and report the error in a readable way. */
const expectFailure = async (fn) => {
  try {
    await fn();
    return { threw: false, note: "NO ERROR — this should not happen" };
  } catch (error) {
    return {
      threw: true,
      name: error.name,
      code: error.code,
      // ValidationError carries a map of per-field errors — this is what you
      // turn into a 400 response.
      fields: error.errors
        ? Object.fromEntries(
            Object.entries(error.errors).map(([path, e]) => [path, e.message])
          )
        : undefined,
      message: error.errors ? undefined : error.message,
    };
  }
};

const cleanup = async () => {
  await User.deleteMany({ email: /@lesson\.test$/ });
  await Product.deleteMany({ sku: /^ZZ-/ });
  // The empty-items order in section 4 SHOULD be rejected by validation, but
  // clean up anyway so a future schema change cannot leave a stray document.
  await Order.deleteMany({ orderNumber: /^ZZZ-/ });
};

await runLesson("Validation, middleware, virtuals 1/3 — Validation", async () => {
  await cleanup(); // clear leftovers from any crashed previous run

  // --------------------------------------------------------------------
  section("1. Built-in validators, and the errors they produce");
  const failure = await expectFailure(() =>
    User.create({
      // name is required and has minlength 2
      name: "A",
      // email must match the schema's regex
      email: "not-an-email",
      // age has min 13
      age: 9,
      // role is an enum
      role: "wizard",
    })
  );
  show("Creating a user that breaks four rules at once", failure);
  note(
    "ONE ValidationError containing FOUR field errors. Mongoose validates " +
      "every path before giving up, which is exactly what a form needs — the " +
      "user sees all their mistakes at once instead of fixing them one " +
      "request at a time. error.errors is keyed by field path, so mapping it " +
      "to a 400 response body is mechanical (see module 15)."
  );

  show("The built-in validators", {
    "all types": "required (boolean, or a function for conditional requirement)",
    Number: "min, max",
    String: "minlength, maxlength, enum, match (regex)",
    Date: "min, max",
    "custom messages": "required: [true, 'Product name is required'] — array form",
    "message templates": "min: [0, 'Price {VALUE} is below the minimum {MIN}']",
  });

  // --------------------------------------------------------------------
  section("2. Casting happens BEFORE validation");
  // Mongoose first tries to convert the value to the schema's type. If that
  // fails you get a CastError, not a ValidationError.
  const castFailure = await expectFailure(() =>
    User.create({ name: "Cast Test", email: `cast@lesson.test`, age: "not a number" })
  );
  show("A value that cannot be cast", castFailure);

  // When casting SUCCEEDS, it happens silently — which is usually helpful
  // (Express query params are always strings) and occasionally surprising.
  const casted = new User({ name: "Cast Ok", email: "OK@LESSON.TEST", age: "34" });
  show("Successful casting and setters", {
    "age given as the string '34'": casted.age,
    typeofAge: typeof casted.age,
    "email lowercased by the schema setter": casted.email,
  });
  note(
    "Order of operations on save: cast -> apply setters/defaults -> run " +
      "validators -> pre('save') middleware -> write. A CastError is reported " +
      "inside error.errors just like a validation error, so your error " +
      "handler can treat both as a 400."
  );

  // --------------------------------------------------------------------
  section("3. Custom validators");
  // Anything the built-ins cannot express. Return false (or throw) to fail.
  const tempSchema = new mongoose.Schema({
    handle: {
      type: String,
      required: true,
      validate: {
        // `this` is the document being validated (in a synchronous validator
        // on a create — see the note below about updates).
        validator: (value) => /^[a-z0-9_]{3,20}$/.test(value),
        // {VALUE} is substituted with the offending value.
        message: (props) => `"${props.value}" is not a valid handle (a-z, 0-9, _ only)`,
      },
    },
    startsAt: { type: Date, required: true },
    endsAt: {
      type: Date,
      required: true,
      validate: {
        // Cross-field validation: `this` gives access to the whole document.
        validator: function (value) {
          return !this.startsAt || value > this.startsAt;
        },
        message: "endsAt must be after startsAt",
      },
    },
    // An ASYNC validator: return a promise. Mongoose awaits it.
    ownerEmail: {
      type: String,
      validate: {
        validator: async (value) => {
          const exists = await User.exists({ email: value });
          return Boolean(exists);
        },
        message: (props) => `No user exists with email ${props.value}`,
      },
    },
  });
  const TempThing = mongoose.models.TempThing ?? mongoose.model("TempThing", tempSchema, "tmp_validation_lab");

  show(
    "Custom validator failures",
    await expectFailure(() =>
      new TempThing({
        handle: "Bad Handle!",
        startsAt: new Date("2026-01-10"),
        endsAt: new Date("2026-01-01"),
        ownerEmail: "nobody@nowhere.test",
      }).validate()
    )
  );
  note(
    "Three custom rules: a regex on one field, a comparison BETWEEN fields, " +
      "and an ASYNC check against the database. Note we called .validate() " +
      "directly — it runs every validator without writing anything, which is " +
      "how you validate a document before deciding to save it."
  );
  note(
    "WARNING about `this` in validators: it refers to the document only " +
      "during document validation (create/save). During an update it is " +
      "undefined unless you pass { context: 'query' }, and even then `this` " +
      "is the QUERY, not the document. Cross-field validators are therefore " +
      "unreliable on updates — this is the single most common validation trap."
  );

  // --------------------------------------------------------------------
  section("4. Array validators");
  // Our Order schema requires at least one item.
  const emptyOrder = await expectFailure(() =>
    Order.create({
      orderNumber: "ZZZ-VALIDATE-1",
      user: new mongoose.Types.ObjectId(),
      items: [], // the schema's custom validator rejects this
      totalAmount: 0,
      shippingAddress: { city: "Pune" },
    })
  );
  show("An order with no line items", emptyOrder);
  note(
    "order.model.js attaches a custom validator to the items array requiring " +
      "length > 0. Array validators run against the WHOLE array; validators " +
      "on the sub-schema's fields run per element, and their error paths look " +
      "like 'items.0.quantity'."
  );

  // --------------------------------------------------------------------
  section("5. THE BIG ONE — validators do NOT run on updates by default");
  // Create a temp product we can safely mutate.
  const temp = await Product.create({
    name: "ZZ Validation Test Product",
    sku: "ZZ-VALID-1",
    price: 1000,
    stock: 5,
    category: (await Product.findOne().select("category").lean()).category,
  });

  // This value breaks the schema's min: 0 rule — but updateOne does not check.
  await Product.updateOne({ _id: temp._id }, { $set: { price: -9999 } });
  const afterBadUpdate = await Product.findById(temp._id).select("price").lean();
  show("updateOne with an invalid value (no runValidators)", {
    schemaRule: "price has min: 0",
    valueNowInDatabase: afterBadUpdate.price,
    "was it rejected?": "NO — the write went straight through",
  });

  // Fix it, then try again WITH validators enabled.
  await Product.updateOne({ _id: temp._id }, { $set: { price: 1000 } });
  const withValidators = await expectFailure(() =>
    Product.updateOne({ _id: temp._id }, { $set: { price: -9999 } }, { runValidators: true })
  );
  show("The same update with { runValidators: true }", withValidators);
  note(
    "This is the most dangerous default in Mongoose. updateOne, updateMany, " +
      "and findOneAndUpdate skip validators unless you pass " +
      "{ runValidators: true } — because Mongoose only has the update " +
      "OPERATORS, not the resulting document, so it cannot check rules that " +
      "depend on other fields. Set it globally in your app: " +
      "mongoose.set('runValidators', true), or pass it on every update."
  );
  show("What runValidators can and cannot check", {
    "checks": "the fields present in the update ($set, $inc, ...) against their own rules",
    "does NOT check": "required — a field absent from the update is simply not examined",
    "does NOT reliably check": "cross-field validators, since `this` is not the document",
    "the safe alternative": "load the document, assign, and call .save() — full document validation",
  });

  // --------------------------------------------------------------------
  section("6. unique is NOT a validator");
  const existingEmail = (await User.findOne().select("email").lean()).email;
  const duplicate = await expectFailure(() =>
    User.create({ name: "Duplicate", email: existingEmail })
  );
  show("Creating a user with an email that already exists", duplicate);
  note(
    "Look at the shape: name is 'MongoServerError' with code 11000 — NOT a " +
      "ValidationError with error.errors. That is because `unique: true` is " +
      "not a rule Mongoose checks; it is a request to build a UNIQUE INDEX, " +
      "and MongoDB rejects the write. Two consequences: (1) the guarantee is " +
      "real and holds against any writer, unlike a validator; (2) your error " +
      "handler needs a separate branch for code 11000, using error.keyPattern " +
      "to know which field collided (module 15)."
  );
  note(
    "Also note: a unique index cannot be built at all if duplicates already " +
      "exist. Adding `unique: true` to a schema with dirty data means " +
      "syncIndexes() fails — clean the data first."
  );

  // --------------------------------------------------------------------
  section("7. Validating without saving");
  const draft = new User({ name: "D", email: "bad" });
  // validateSync() returns the error instead of throwing — handy in tests
  // and for pre-flight checks.
  const syncError = draft.validateSync();
  show("validateSync()", {
    returnedInsteadOfThrowing: Boolean(syncError),
    fields: syncError ? Object.keys(syncError.errors) : [],
  });
  // You can also validate a subset of paths.
  const partial = draft.validateSync(["email"]);
  show("validateSync(['email']) — only that path", {
    fields: partial ? Object.keys(partial.errors) : [],
  });
  note(
    "validateSync() skips async validators (it cannot await them). Use " +
      "await doc.validate() when any validator is async."
  );

  // --------------------------------------------------------------------
  section("8. Where validation belongs in a real app");
  show("Three layers, three jobs", {
    "1. Request validation (Joi / zod, at the route)":
      "reject malformed input early with a clear 400, before touching the DB",
    "2. Mongoose validators (the model)":
      "the last line of defence for anything writing through your models — invariants that belong to the DATA, not the request",
    "3. Database constraints (unique/partial indexes, $jsonSchema)":
      "the only rules that hold against migrations, scripts, and other services",
    "the mistake to avoid":
      "relying on ONE layer. Route validation misses your own scripts; Mongoose validators miss the mongosh session; indexes cannot express business rules.",
  });

  // --------------------------------------------------------------------
  section("9. Cleanup");
  await cleanup();
  await mongoose.connection.db.collection("tmp_validation_lab").drop().catch(() => {});
  show("Cleanup", {
    tempUsers: await User.countDocuments({ email: /@lesson\.test$/ }),
    tempProducts: await Product.countDocuments({ sku: /^ZZ-/ }),
  });
  note("Next: 02-middleware — hooks that run before and after your operations.");
});
