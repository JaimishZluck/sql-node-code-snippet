/**
 * LESSON 03-mongoose-basics/01-schema-model-document — Schema, Model, Document
 *
 * The layers of Mongoose made visible on the real User model: the MODEL as a
 * class compiled from a schema and bound to one collection, the DOCUMENT as
 * an instance of that class (alive in memory, with an _id, BEFORE any save),
 * and the QUERY as the builder object that carries a request to the server.
 * Plus: manual validate(), save(), instance vs static methods, toObject().
 *
 * Temp data: one user with an email ending "@lesson.test" (the bootcamp's
 * temp marker) — created here and deleted in the cleanup section. Seeded
 * documents are never modified.
 *
 * Run it with:  npm run lesson 03-mongoose-basics/01-schema-model-document
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";

// Temp-data marker: any user whose email ends in "@lesson.test" belongs to a
// lesson and is safe to delete. Seeded users never match this pattern.
const TEMP_EMAIL = "asha.demo@lesson.test";
const TEMP_EMAIL_PATTERN = /@lesson\.test$/;

await runLesson("Schema → Model → Document (on the real User model)", async () => {
  // A crashed earlier run may have left temp users behind. Remove them first
  // so this lesson always starts from a clean state. (Temp users only!)
  await User.deleteMany({ email: TEMP_EMAIL_PATTERN });

  try {
    section("1. The MODEL — a class compiled from a schema, bound to ONE collection");

    // `User` was produced (once, at import time) by
    // mongoose.model("User", userSchema): the schema COMPILED into a class,
    // registered under the name "User" on the default connection.
    show("User.modelName", User.modelName);

    // Every model is bound to exactly one collection. userSchema says
    // `collection: "users"` explicitly, so there is no naming magic here...
    show("User.collection.name", User.collection.name);

    // ...but without that option Mongoose would derive the same name by
    // lowercasing + pluralizing the model name. This is the very function
    // it uses internally:
    const toCollectionName = mongoose.pluralize();
    show('pluralize("User")', toCollectionName("User"));
    show('pluralize("Category")', toCollectionName("Category"));

    // The compiled model still carries its schema — every field's rules stay
    // inspectable. This is how populate() and tooling learn about your fields.
    show('User.schema.path("email").instance', User.schema.path("email").instance);
    show('User.schema.path("email").options', User.schema.path("email").options);

    note(
      "A model = schema (the rules) + collection name (the where) + connection (the how). " +
        "The collection itself lives on the MongoDB server and has NO idea these rules exist."
    );

    section("2. A brand-new DOCUMENT — it has an _id before any save");

    // Calling the model as a constructor builds a document in memory.
    // This is a pure JavaScript operation — no network is involved yet.
    const asha = new User({
      name: "  Asha Demo  ", // extra spaces on purpose — watch `trim` remove them
      email: TEMP_EMAIL.toUpperCase(), // uppercase on purpose — watch `lowercase` fix it
      age: 29,
      interests: ["reading", "yoga"],
    });

    // Surprise #1: the _id already exists. ObjectIds are generated
    // CLIENT-SIDE (4-byte timestamp + 5 random bytes + 3-byte counter), so
    // no server round-trip is needed to know a document's identity.
    show("asha._id (no save has happened!)", asha._id);
    note(
      "Client-side ObjectId generation is why you can wire documents together BEFORE saving " +
        "anything: order.user = user._id works even while both are still unsaved. A SQL " +
        "auto-increment id, by contrast, exists only AFTER the INSERT returns."
    );

    // Surprise #2: setters (trim, lowercase) already ran during assignment —
    // not at save time.
    show("asha.name  (trim setter already applied)", asha.name);
    show("asha.email (lowercase setter already applied)", asha.email);

    // Surprise #3: defaults are filled in immediately too.
    show("asha.role (schema default)", asha.role);
    show("asha.isActive (schema default)", asha.isActive);

    // isNew answers: "does Mongoose believe this document is not in the DB yet?"
    show("asha.isNew", asha.isNew);

    section("3. validate() — run every schema rule WITHOUT touching the database");

    // validate() checks required/enum/min/match/... entirely in Node. It is
    // async only because CUSTOM validators are allowed to be async — the
    // built-in rules involve no I/O at all.
    await asha.validate();
    note("No error thrown — asha satisfies every rule. The server was not contacted.");

    // Now a document that breaks several rules at once: no name (required),
    // a malformed email (match), and age 7 (min is 13).
    const broken = new User({ email: "not-an-email", age: 7 });
    try {
      await broken.validate();
    } catch (err) {
      show("err.name", err.name); // ValidationError — a MONGOOSE error class
      show("failing paths", Object.keys(err.errors));
      show("message for 'email'", err.errors.email.message);
    }
    note(
      "ValidationError is produced by Mongoose inside Node. Lesson 03 of this module proves " +
        "which rules stay in Node and which only the SERVER can enforce (spoiler: unique)."
    );

    section("4. save() — the document crosses the network for the first time");

    // save() = validate again + write. Because isNew is true, the write is an
    // insert: the driver encodes the document as BSON and sends it over a
    // pooled socket (see module 02).
    await asha.save();
    show("asha.isNew after save", asha.isNew);

    // `timestamps: true` in the schema maintained these automatically:
    show("asha.createdAt", asha.createdAt);
    show("asha.updatedAt", asha.updatedAt);
    note(
      "save() on a NEW document performs an insert. On an already-saved document it sends " +
        "ONLY the changed paths as a $set — Mongoose tracks modifications per field."
    );

    section("5. The QUERY — built first, executed only when awaited");

    // Calling .find() runs NOTHING. It returns a Query: a builder object
    // that accumulates filter, projection, sort, limit...
    const q = User.find({ role: "admin" });
    show("q instanceof mongoose.Query", q instanceof mongoose.Query);
    show("q.getFilter()", q.getFilter());

    // Only awaiting it (or .exec(), or .then()) casts the filter, sends the
    // command to the server, and hydrates the reply.
    const admins = await q;
    show("admins.length (seed data has 2 admins)", admins.length);
    show("first result is a hydrated User instance", admins[0] instanceof User);

    // Casting demo: findById with a STRING. Mongoose casts it to an ObjectId
    // using the schema before sending — the server only ever sees real BSON
    // types. The raw driver would find NOTHING with a string here.
    const idAsString = asha._id.toString();
    const foundAgain = await User.findById(idAsString);
    show("found by string id?", foundAgain !== null);
    show("foundAgain.isNew (came from the DB)", foundAgain.isNew);
    show("foundAgain.isDeleted (virtual, computed in Node)", foundAgain.isDeleted);
    note(
      "Query results are HYDRATED: raw BSON from the server is wrapped back into Document " +
        "instances with methods, virtuals, and change tracking. (lean() skips hydration and " +
        "returns plain objects — module 10.)"
    );

    section("6. Instance (document) methods vs static (model) methods");

    // Instance methods live on the DOCUMENT — they act on one record:
    show("typeof asha.save", typeof asha.save);
    show("typeof asha.validate", typeof asha.validate);
    show("typeof asha.toObject", typeof asha.toObject);

    // Statics live on the MODEL — they act on the whole collection:
    show("typeof User.find", typeof User.find);
    show("typeof User.create", typeof User.create);

    // ...and they do not cross over:
    show("typeof User.save (no such static)", typeof User.save);
    show("typeof asha.find (no such instance method)", typeof asha.find);
    note(
      "Rule of thumb: if 'which document?' is already answered, use an instance method " +
        "(asha.save()). If it still needs a filter to answer, use a model static (User.find(...))."
    );

    section("7. toObject() — stepping down from Document to plain object");

    const plain = asha.toObject();
    show("plain.constructor.name", plain.constructor.name); // "Object" — not a User
    show("typeof plain.save (methods are gone)", typeof plain.save);
    show("'isDeleted' in plain (virtuals are OFF by default)", "isDeleted" in plain);

    // Opting in to virtuals for this one conversion:
    const withVirtuals = asha.toObject({ virtuals: true });
    show("withVirtuals.isDeleted", withVirtuals.isDeleted);

    note(
      "toObject() copies the data out of the document wrapper: no change tracking, no .save(), " +
        "no virtuals unless requested. Its sibling toJSON() is what JSON.stringify / res.json " +
        "call automatically — the README explains when to configure each."
    );
  } finally {
    section("Cleanup — deleting TEMP lesson data only");
    // Deletes only users whose email ends in "@lesson.test" (our temp
    // marker). Seeded users are untouched.
    const result = await User.deleteMany({ email: TEMP_EMAIL_PATTERN });
    show("temp users deleted", result.deletedCount);
  }
});
