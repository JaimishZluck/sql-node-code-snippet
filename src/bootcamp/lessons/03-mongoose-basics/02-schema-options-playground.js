/**
 * LESSON 03-mongoose-basics/02-schema-options-playground — Schema options in action
 *
 * A hands-on tour of the schema options the main models DON'T demonstrate:
 * immutable, alias, select:false, default-as-a-function, a custom validator
 * with its own message, and a get/set pair. Everything runs on a THROWAWAY
 * model bound to the temp collection `tmp_gadgets`, which is dropped at the
 * end — the seeded collections are never touched.
 *
 * Run it with:  npm run lesson 03-mongoose-basics/02-schema-options-playground
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";

// Temp-collection marker: collections named tmp_* belong to lessons and are
// safe to drop at any time.
const TMP_COLLECTION = "tmp_gadgets";

// Used by the default-as-a-function demo below: the default closes over this
// counter, so every NEW document receives the next number.
let lotCounter = 0;

const gadgetSchema = new mongoose.Schema(
  {
    // immutable: once the document EXISTS in the database, this field is
    // frozen. Ideal for identifiers that must never change (serial numbers,
    // invoice numbers, createdBy). A NEW unsaved document can still set it —
    // otherwise the field could never receive a value at all.
    serial: {
      type: String,
      required: true,
      uppercase: true, // setter: normalize before storing ("gad-1" -> "GAD-1")
      trim: true,
      immutable: true,
    },

    // alias: "nickname" becomes a second, virtual name for this same stored
    // field. The database only ever sees "codeName"; your JS code may use
    // either name.
    codeName: {
      type: String,
      trim: true,
      alias: "nickname",
    },

    // select: false — the field IS stored, but every query EXCLUDES it
    // unless you explicitly ask with .select("+secretNote").
    // The classic real-world use: password hashes on a User model.
    secretNote: {
      type: String,
      select: false,
      default: "internal - do not show in listings",
    },

    // default as a FUNCTION: evaluated once PER new document, at creation
    // time. A plain value would be computed once (when the schema file
    // loads) and shared by every document forever.
    lotNumber: {
      type: Number,
      default: () => ++lotCounter,
    },

    // The classic date default. NOTE: `Date.now` — the function itself, NOT
    // `Date.now()`. Calling it here would bake ONE timestamp into the schema
    // at load time and stamp every future document with that same moment.
    addedAt: {
      type: Date,
      default: Date.now,
    },

    // get/set pair. We STORE integer paise (integers dodge float rounding
    // errors in money math) but EXPOSE rupees to the application:
    //   set: runs when you assign — rupees in, paise stored
    //   get: runs when you read   — paise out, rupees shown
    price: {
      type: Number,
      min: 0,
      set: (rupees) => Math.round(rupees * 100),
      get: (paise) => (paise == null ? paise : paise / 100),
    },

    // A custom validator with a custom message. Like every validator, it
    // runs in Node during validate()/save() — see lesson 03.
    warrantyMonths: {
      type: Number,
      default: 0,
      validate: {
        validator: (months) =>
          Number.isInteger(months) && months >= 0 && months % 6 === 0,
        message: (props) =>
          `warrantyMonths must be a non-negative multiple of 6, got ${props.value}`,
      },
    },
  },
  {
    collection: TMP_COLLECTION, // explicit temp collection — no pluralization magic
    timestamps: true, // createdAt/updatedAt maintained automatically
  }
);

// Guard against double compilation (hot reload / repeated import): reuse the
// already-registered model if it exists, otherwise compile it now.
const TmpGadget =
  mongoose.models.TmpGadget || mongoose.model("TmpGadget", gadgetSchema);

await runLesson("Schema options playground (temp collection tmp_gadgets)", async () => {
  // DESTRUCTIVE — TEMP COLLECTION ONLY: a crashed earlier run may have left
  // tmp_gadgets behind; drop it so this run always starts clean.
  await mongoose.connection.dropCollection(TMP_COLLECTION).catch(() => {});

  try {
    section("1. default as a FUNCTION — a fresh value for EACH document");

    // create() = new TmpGadget(...) + save() for each entry. Note we can use
    // the alias "nickname" even here — Mongoose translates it to codeName.
    const [zippy, quark] = await TmpGadget.create([
      { serial: "gad-001", nickname: "Zippy", price: 499.99 },
      { serial: "gad-002", nickname: "Quark", price: 1250 },
    ]);

    show("zippy.lotNumber", zippy.lotNumber);
    show("quark.lotNumber", quark.lotNumber);
    show("zippy.serial (uppercase setter ran)", zippy.serial);
    show("zippy.addedAt (Date.now default ran at creation)", zippy.addedAt);
    note(
      "The default function ran once for EACH document (1, then 2). Written as " +
        "`default: ++lotCounter` (a value, not a function) it would have been evaluated a " +
        "single time when this file loaded — the exact same trap as Date.now() vs Date.now."
    );

    section("2. immutable — silently frozen after the first save");

    // The document already exists in the DB (isNew is false), so this
    // assignment is IGNORED — no error, no change. That silence is by
    // design: set the schema option strict:"throw" if you prefer an error.
    zippy.serial = "HACKED-001";
    show("zippy.serial after assignment attempt", zippy.serial);
    show('zippy.isModified("serial")', zippy.isModified("serial"));

    // Update operations strip immutable paths too (in default strict mode):
    await TmpGadget.updateOne({ _id: zippy._id }, { serial: "HACKED-002" });
    const reloaded = await TmpGadget.findById(zippy._id);
    show("serial in the DB after the updateOne attempt", reloaded.serial);
    note(
      "Both the assignment and the updateOne silently dropped the change to `serial`. " +
        "(The updateOne still bumped updatedAt — the timestamps option maintains it on " +
        "updates as well.) Remember: immutable is a MONGOOSE rule. The native driver, or any " +
        "other app, could still overwrite the field — lesson 03 shows that bypass."
    );

    section("3. alias — one stored name, one code-friendly name");

    show("zippy.nickname (alias reads codeName)", zippy.nickname);
    zippy.nickname = "Zippy v2"; // writing the alias writes codeName
    show("zippy.codeName after writing via the alias", zippy.codeName);
    show("keys actually stored (no 'nickname' anywhere)", Object.keys(zippy.toObject()));

    // Query filters use the REAL path by default. translateAliases() converts
    // an alias-keyed object into a storage-keyed one for you:
    show(
      'TmpGadget.translateAliases({ nickname: "Zippy v2" })',
      TmpGadget.translateAliases({ nickname: "Zippy v2" })
    );
    note(
      "Aliases exist only inside Mongoose. Teams use them to keep SHORT stored keys (bytes " +
        "matter across millions of documents) while application code stays readable — the " +
        "database itself never sees 'nickname'."
    );

    section("4. select: false — stored, but hidden from query results");

    const normal = await TmpGadget.findById(zippy._id);
    show("normal.secretNote (excluded by default)", normal.secretNote);

    // The "+" prefix means: keep the normal selection AND add back this
    // excluded field.
    const withSecret = await TmpGadget.findById(zippy._id).select("+secretNote");
    show('with .select("+secretNote")', withSecret.secretNote);

    // Proof the value really is in the database: read the raw document with
    // the native driver, which knows nothing about schemas or select rules.
    const rawDoc = await mongoose.connection.db
      .collection(TMP_COLLECTION)
      .findOne({ _id: zippy._id });
    show("raw driver read — secretNote sits in the DB", rawDoc.secretNote);
    note(
      "Two lessons in one: (a) the default text was applied in Node at creation and STORED " +
        "like any normal field; (b) select:false is only a query-time projection Mongoose adds " +
        "for you — it is convenience, not encryption, and not server-side security."
    );

    section("5. get/set — store paise, talk rupees");

    show("zippy.price (getter output: rupees)", zippy.price);
    show("zippy.toObject().price (raw stored paise)", zippy.toObject().price);
    show("zippy.toObject({ getters: true }).price", zippy.toObject({ getters: true }).price);
    note(
      "The setter turned 499.99 rupees into 49999 paise at assignment; the getter converts " +
        "back on every read. toObject()/toJSON() SKIP getters unless you opt in — remember " +
        "this the day an API response suddenly shows paise instead of rupees."
    );

    section("6. custom validate — your rule, your error message");

    const dodgy = new TmpGadget({ serial: "gad-003", warrantyMonths: 7 });
    try {
      // Validation runs first, in Node — the insert never happens.
      await dodgy.save();
    } catch (err) {
      show("err.name", err.name);
      show("err.errors.warrantyMonths.message", err.errors.warrantyMonths.message);
    }

    const count = await TmpGadget.countDocuments();
    show("documents in tmp_gadgets (dodgy was never inserted)", count);
    note(
      "The message function received the offending value (props.value = 7) and produced a " +
        "human-readable error — exactly what you would surface to an API client."
    );
  } finally {
    section("Cleanup — DESTRUCTIVE, temp collection only");
    // Drop the whole temp collection. Allowed ONLY because tmp_* collections
    // belong to lessons — never do this to a real collection.
    await mongoose.connection.dropCollection(TMP_COLLECTION).catch(() => {});
    note(`Dropped ${TMP_COLLECTION}. Seeded collections were never touched.`);
  }
});
