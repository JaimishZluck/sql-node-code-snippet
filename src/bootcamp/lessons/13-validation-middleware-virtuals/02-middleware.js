/**
 * LESSON 13-validation-middleware-virtuals/02-middleware — Hooks
 *
 * Middleware (also called "hooks") lets you run code automatically before or
 * after an operation: hash a password before saving, normalize a field,
 * write an audit record after an update, cascade a delete.
 *
 * The one thing that trips everybody up is `this`:
 *
 *   DOCUMENT middleware  (save, validate, remove)  -> `this` is the DOCUMENT
 *   QUERY middleware     (find, findOneAndUpdate,
 *                         updateOne, deleteOne...) -> `this` is the QUERY
 *
 * A pre('save') hook can read this.email. A pre('findOneAndUpdate') hook
 * cannot — there is no document yet, only an update description. Getting
 * this wrong produces hooks that silently do nothing.
 *
 * SAFE TO RE-RUN: everything happens on a throwaway model bound to the
 * temporary collection `tmp_hooks_lab`, plus temp users (@lesson.test),
 * all removed at the end.
 *
 * Run it with:  npm run lesson 13-validation-middleware-virtuals/02-middleware
 */
import mongoose from "mongoose";
import crypto from "crypto";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";

const TEMP_COLLECTION = "tmp_hooks_lab";
const trace = [];
const log = (entry) => trace.push(entry);

await runLesson("Validation, middleware, virtuals 2/3 — Middleware", async () => {
  const db = mongoose.connection.db;
  await db.collection(TEMP_COLLECTION).drop().catch(() => {});
  await User.deleteMany({ email: /@lesson\.test$/ });

  // --------------------------------------------------------------------
  section("1. Building a schema with every hook attached");
  const accountSchema = new mongoose.Schema(
    {
      email: { type: String, required: true, lowercase: true, trim: true },
      passwordHash: String,
      password: { type: String, select: false }, // never stored; see pre('save')
      displayName: String,
      slug: String,
      loginCount: { type: Number, default: 0 },
      // Written by the pre('findOneAndUpdate') hook below. It must exist in
      // the schema, or strict mode would silently strip it from the update.
      updatedBy: String,
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );

  // ---- DOCUMENT middleware: `this` is the document ----

  // pre('validate') runs BEFORE validators, so it is the right place to
  // DERIVE a field that is itself required or validated.
  accountSchema.pre("validate", function (next) {
    log("pre(validate) — this is a Document");
    if (this.displayName && !this.slug) {
      this.slug = this.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    next();
  });

  // pre('save') runs after validation, just before the write. The classic
  // use: hashing a password.
  accountSchema.pre("save", function (next) {
    log(`pre(save) — isNew=${this.isNew}`);
    // isModified() tells you whether a path changed since the document was
    // loaded. Without this guard you would re-hash the hash on every save.
    if (this.password && this.isModified("password")) {
      this.passwordHash = crypto.createHash("sha256").update(this.password).digest("hex");
      this.password = undefined; // never persist the plaintext
    }
    next();
  });

  // Hooks run in the ORDER they are registered. Multiple pre('save') hooks
  // form a chain, each calling next().
  accountSchema.pre("save", function (next) {
    log("pre(save) #2 — hooks run in registration order");
    next();
  });

  // post('save') receives the SAVED document. Use it for side effects:
  // sending a welcome email, writing an audit log, warming a cache.
  accountSchema.post("save", function (doc) {
    log(`post(save) — document _id ${doc._id} is now persisted`);
  });

  // An ASYNC hook: return a promise (or use async/await) and omit next().
  accountSchema.pre("save", async function () {
    log("pre(save) #3 — async hook, no next() needed");
  });

  // ---- QUERY middleware: `this` is the Query, NOT a document ----

  // The classic soft-delete filter: silently exclude deleted records from
  // every find. A regex matches find, findOne, findOneAndUpdate, etc.
  accountSchema.pre(/^find/, function (next) {
    log(`pre(${this.op}) — this is a Query, not a Document`);
    // getFilter() reads the query's filter; only add ours if the caller has
    // not explicitly asked about deletedAt.
    if (this.getFilter().deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
    next();
  });

  // pre('findOneAndUpdate'): `this` is the query. You CANNOT read document
  // fields here — you can only inspect and modify the UPDATE.
  accountSchema.pre("findOneAndUpdate", function (next) {
    log("pre(findOneAndUpdate) — modifying the update, not a document");
    // getUpdate()/setUpdate() are how you touch the update description.
    this.setUpdate({ ...this.getUpdate(), $set: { ...this.getUpdate().$set, updatedBy: "hook" } });
    // Make sure validators run and the new document is returned, so callers
    // cannot forget.
    this.setOptions({ runValidators: true, new: true });
    next();
  });

  // post query middleware receives the RESULT (a document, an array, or the
  // write result depending on the operation).
  accountSchema.post("find", function (docs) {
    log(`post(find) — received ${docs.length} document(s)`);
  });

  const Account = mongoose.models.LessonAccount
    ?? mongoose.model("LessonAccount", accountSchema, TEMP_COLLECTION);

  show("Hooks registered", {
    document: ["pre(validate)", "pre(save) x3", "post(save)"],
    query: ["pre(/^find/)", "pre(findOneAndUpdate)", "post(find)"],
  });

  // --------------------------------------------------------------------
  section("2. Watching document middleware run on create");
  trace.length = 0;
  const account = await Account.create({
    email: "  HOOKS@LESSON.TEST  ",
    displayName: "Hook Demo Account",
    password: "secret123",
  });
  show("Execution order", trace);
  show("The saved document", {
    email: account.email, // trimmed + lowercased by schema setters
    slug: account.slug, // derived in pre('validate')
    passwordHash: `${account.passwordHash.slice(0, 16)}...`,
    plaintextStored: account.password ?? "(removed before saving)",
  });
  note(
    "Setters ran first (trim, lowercase), then pre('validate') derived the " +
      "slug, then validators, then the three pre('save') hooks in " +
      "registration order, then the write, then post('save'). Deriving the " +
      "slug in pre('validate') rather than pre('save') matters whenever the " +
      "derived field is itself required — validation would otherwise fail " +
      "before your hook ever ran."
  );

  // --------------------------------------------------------------------
  section("3. Watching query middleware run");
  trace.length = 0;
  await Account.create({ email: "deleted@lesson.test", displayName: "Deleted One", deletedAt: new Date() });
  const visible = await Account.find({});
  show("Execution order", trace);
  show("Soft-delete filter in action", {
    documentsInCollection: await Account.collection.countDocuments(),
    returnedByFind: visible.length,
    "the deleted one": "silently excluded by pre(/^find/)",
  });
  note(
    "This is the single most useful query hook there is: every find in your " +
      "codebase automatically skips soft-deleted records, with no discipline " +
      "required from callers. Two warnings: (1) it does NOT apply to " +
      "aggregate() or to native-driver calls, which bypass Mongoose " +
      "middleware entirely; (2) always provide an escape hatch (a query " +
      "option, or checking getOptions()) so admin tools can see everything."
  );

  // --------------------------------------------------------------------
  section("4. The document-vs-query trap, demonstrated");
  trace.length = 0;
  const updated = await Account.findOneAndUpdate(
    { email: "hooks@lesson.test" },
    { $inc: { loginCount: 1 } }
  );
  show("Execution order", trace);
  show("Result", {
    loginCount: updated?.loginCount,
    updatedBy: updated?.get("updatedBy"),
    "pre('save') ran?": trace.some((t) => t.startsWith("pre(save)")),
  });
  note(
    "Notice pre('save') did NOT run. findOneAndUpdate sends an update " +
      "command straight to MongoDB — no document is ever loaded into Node, " +
      "so document middleware has nothing to hook onto. If your password " +
      "hashing lives in pre('save') and someone updates the password with " +
      "findOneAndUpdate, the PLAINTEXT gets stored. This is a real security " +
      "bug that ships regularly."
  );
  show("Which hooks fire for which operation", {
    "Model.create() / doc.save()": "validate + save document hooks",
    "insertMany()": "only insertMany hooks — NOT save (pass { rawResult: false } and note validators DO run)",
    "find / findOne / findById": "query hooks (pre/post find*)",
    "updateOne / updateMany / findOneAndUpdate": "query hooks only — NO save hooks",
    "deleteOne / deleteMany (Model.*)": "query hooks",
    "doc.deleteOne()": "document hooks",
    "aggregate()": "only aggregate hooks — NO find or save hooks",
    "native driver via connection.db": "NO Mongoose hooks at all",
  });

  // --------------------------------------------------------------------
  section("5. Error handling in middleware");
  const guardedSchema = new mongoose.Schema({ value: Number });

  // Passing an Error to next() aborts the operation.
  guardedSchema.pre("save", function (next) {
    if (this.value < 0) return next(new Error("value must not be negative"));
    next();
  });

  // ERROR-HANDLING middleware: a post hook with (error, doc, next) turns
  // low-level errors into friendly ones. This is where you translate E11000.
  guardedSchema.post("save", function (error, doc, next) {
    if (error.code === 11000) return next(new Error("That value already exists"));
    next(error);
  });

  const Guarded = mongoose.models.LessonGuarded
    ?? mongoose.model("LessonGuarded", guardedSchema, "tmp_hooks_guarded");

  let hookError = null;
  try {
    await Guarded.create({ value: -5 });
  } catch (error) {
    hookError = error.message;
  }
  show("An error thrown from a pre hook", { message: hookError });
  note(
    "next(error) stops the chain and rejects the promise — nothing is " +
      "written. The four-argument post hook (error, doc, next) is Mongoose's " +
      "error-handling middleware: the standard place to convert an ugly " +
      "E11000 into 'That email is already registered'. Throwing from an " +
      "async hook works the same way."
  );

  // --------------------------------------------------------------------
  section("6. Realistic uses");
  show("What hooks are genuinely good for", {
    "hash passwords": "pre('save') + isModified('password') — the canonical example",
    "normalize data": "trim, lowercase, generate slugs (prefer pre('validate') for derived fields)",
    "soft-delete filter": "pre(/^find/) adding { deletedAt: null }",
    "audit trail": "post('save') / post('findOneAndUpdate') writing to an audit collection",
    "keep a denormalized copy in sync":
      "post('save') on Review recomputing product.ratingSummary",
    "enforce update options": "pre hook calling this.setOptions({ runValidators: true })",
  });
  show("What hooks are BAD for", {
    "heavy or slow work": "every save waits for it; use a queue instead",
    "cascading deletes across many collections":
      "no transaction wraps them — a partial cascade leaves inconsistent data",
    "business logic you need to test in isolation":
      "hooks fire implicitly; a service function is easier to reason about",
    "anything that must ALSO apply to aggregate() or the native driver":
      "hooks simply do not run there",
    "recursion": "saving the same model inside its own post('save') is an infinite loop",
  });

  // --------------------------------------------------------------------
  section("7. Cleanup");
  await db.collection(TEMP_COLLECTION).drop().catch(() => {});
  await db.collection("tmp_hooks_guarded").drop().catch(() => {});
  await User.deleteMany({ email: /@lesson\.test$/ });
  show("Cleanup", { droppedCollections: [TEMP_COLLECTION, "tmp_hooks_guarded"] });
  note("Next: 03-virtuals-getters-setters — computed fields and shaping API output.");
});
