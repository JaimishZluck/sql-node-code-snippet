/**
 * LESSON 04-crud/04-delete — Deleting documents
 *
 * The delete family: `deleteOne` / `deleteMany` (return a count, not the
 * doc), `findOneAndDelete` / `findByIdAndDelete` (return the DOCUMENT you
 * just removed — your last chance to see it), the document-instance
 * `doc.deleteOne()`, and a safe, vivid demonstration of why `deleteMany({})`
 * is the most dangerous single line in MongoDB.
 *
 * SAFETY: every delete here targets practice docs this lesson creates
 * (emails `...@lesson.test`) or a throwaway `tmp_...` collection. The
 * deleteMany({}) demo runs ONLY on that temp collection — never on seeded
 * data. Leftovers from crashed runs are swept at the start, and a
 * finally-block cleans everything at the end.
 *
 * Run it with:  npm run lesson 04-crud/04-delete
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";

const TEMP_EMAIL = /@lesson\.test$/i;
const TMP_COLLECTION = "tmp_crud_delete_demo"; // tmp_ prefix = disposable

/** DESTRUCTIVE — only for practice users and the tmp_ demo collection. */
async function removeTempData() {
  const users = await User.deleteMany({ email: TEMP_EMAIL });
  // Dropping a collection that does not exist can throw — ignore that case.
  await mongoose.connection.db
    .collection(TMP_COLLECTION)
    .drop()
    .catch(() => {});
  return { tempUsersRemoved: users.deletedCount };
}

await runLesson("CRUD 4/4 — Deleting documents", async () => {
  section("0. Safety sweep + create the practice docs this lesson will delete");
  show("Leftovers removed (0 is normal)", await removeTempData());

  try {
    // Practice users — the ONLY user docs this lesson deletes. insertMany:
    // one bulk command is plenty here (see lesson 01-create).
    await User.insertMany([
      { name: "Dara Deletedemo", email: "delete.one@lesson.test" },
      { name: "Esha Deletedemo", email: "delete.two@lesson.test" },
      { name: "Farid Deletedemo", email: "delete.three@lesson.test" },
      { name: "Gita Deletedemo", email: "delete.four@lesson.test" },
      { name: "Hari Deletedemo", email: "delete.five@lesson.test" },
    ]);
    show(
      "Practice users created",
      await User.countDocuments({ email: TEMP_EMAIL }) // expect 5
    );

    // ------------------------------------------------------------------
    section("1. deleteOne(filter) — remove the first match, get back a count");
    const one = await User.deleteOne({ email: "delete.one@lesson.test" });
    show("deleteOne result", one); // { acknowledged: true, deletedCount: 1 }

    // Deleting something that is already gone is NOT an error — you just
    // get deletedCount: 0. Silent no-ops cut both ways.
    const again = await User.deleteOne({ email: "delete.one@lesson.test" });
    show("Deleting the same user again", again); // deletedCount: 0
    note(
      "Two lessons here. (1) The document is NOT returned — if you need to " +
        "know what you deleted, see findOneAndDelete below. (2) deletedCount: 0 " +
        "raises no error, so 'delete succeeded' and 'there was nothing to " +
        "delete' look identical unless you CHECK the count. APIs often map " +
        "deletedCount: 0 to a 404."
    );
    note(
      "If the filter matches MANY docs, deleteOne removes an UNSPECIFIED " +
        "first match (natural order) — like findOne without a sort. Always " +
        "aim deleteOne at a unique key (_id, email, sku)."
    );

    // ------------------------------------------------------------------
    section("2. findOneAndDelete(filter) — delete AND see what you deleted");
    // One atomic server-side command (findAndModify): fetch the doc and
    // remove it, with no gap in between for anyone else to grab it.
    const removed = await User.findOneAndDelete({ email: "delete.two@lesson.test" });
    show("The document that was just deleted", {
      name: removed.name,
      email: removed.email,
      _id: removed._id,
    });

    const nothing = await User.findOneAndDelete({ email: "delete.two@lesson.test" });
    show("Second call (nothing left to delete)", nothing); // null
    note(
      "Returns the deleted DOCUMENT, or null when no match — same " +
        "doc-or-null contract as findOne. Real-world uses: archive/log a " +
        "record as you remove it, or atomically 'pop' a job off a queue " +
        "collection so no two workers can claim the same job."
    );

    // ------------------------------------------------------------------
    section("3. findByIdAndDelete(id) — the same thing, keyed by _id");
    // Sugar for findOneAndDelete({ _id: id }) — the natural fit for
    // DELETE /users/:id routes.
    const farid = await User.findOne({ email: "delete.three@lesson.test" });
    const deleted = await User.findByIdAndDelete(farid._id);
    show("Deleted by id", { name: deleted?.name, _id: deleted?._id });
    note(
      "null instead of a doc means the id matched nothing -> respond 404. " +
        "Watch out for OLD tutorials: findByIdAndRemove / findOneAndRemove " +
        "were removed from Mongoose — in v8 only the ...AndDelete forms exist."
    );

    // ------------------------------------------------------------------
    section("4. doc.deleteOne() — deleting via a document you already hold");
    // When you already loaded the document, you can delete through the
    // instance. In Mongoose 8 this returns a query; awaiting it runs the
    // delete. (doc.remove() from old tutorials no longer exists.)
    const gita = await User.findOne({ email: "delete.four@lesson.test" });
    const instanceResult = await gita.deleteOne();
    show("doc.deleteOne() result", instanceResult);
    note(
      "Look for deletedCount: 1. Instance deletes shine when business logic " +
        "already fetched and inspected the doc ('only delete if it is safe') " +
        "and document middleware should fire. For everything else, the model " +
        "methods above skip the extra fetch."
    );

    // ------------------------------------------------------------------
    section("5. deleteMany(filter) — every match, one command [DESTRUCTIVE: temp docs only]");
    // Add a few more practice users so the bulk delete has something to do.
    await User.insertMany([
      { name: "Bulk A Deletedemo", email: "bulk.a@lesson.test" },
      { name: "Bulk B Deletedemo", email: "bulk.b@lesson.test" },
      { name: "Bulk C Deletedemo", email: "bulk.c@lesson.test" },
    ]);
    const beforeBulk = await User.countDocuments({ email: TEMP_EMAIL });
    show("Practice users before deleteMany", beforeBulk); // 4: delete.five + 3 bulk

    // DESTRUCTIVE — but the filter targets ONLY @lesson.test practice docs.
    const bulk = await User.deleteMany({ email: TEMP_EMAIL });
    show("deleteMany result", bulk); // deletedCount: 4
    note(
      "Same result shape as deleteOne — acknowledged + deletedCount, no " +
        "documents. The FILTER is the entire safety mechanism: it is the only " +
        "thing that decided those 4 docs died and the 30 seeded users lived."
    );

    // ------------------------------------------------------------------
    section("6. The deleteMany({}) danger — demonstrated on a THROWAWAY collection");
    // An empty filter matches EVERY document. To feel what that means
    // without risking real data, build a disposable tmp_ collection with
    // the raw driver and wipe THAT.
    const tmp = mongoose.connection.db.collection(TMP_COLLECTION);
    await tmp.insertMany([
      { orderNumber: "ZZZ-900001", note: "practice doc" },
      { orderNumber: "ZZZ-900002", note: "practice doc" },
      { orderNumber: "ZZZ-900003", note: "practice doc" },
      { orderNumber: "ZZZ-900004", note: "practice doc" },
      { orderNumber: "ZZZ-900005", note: "practice doc" },
    ]);
    show("Docs in the throwaway collection", await tmp.countDocuments()); // 5

    // DESTRUCTIVE — deliberately, on the tmp_ collection ONLY: the empty
    // filter {} matches everything.
    const wiped = await tmp.deleteMany({});
    show("deleteMany({}) result", wiped); // deletedCount: 5 — ALL of them
    show("Docs left afterwards", await tmp.countDocuments()); // 0

    // The collection itself (and any indexes) still exists after
    // deleteMany({}); drop() removes the collection entirely.
    await tmp.drop().catch(() => {});
    note(
      "One line, five documents gone — no confirmation, no undo, no recycle " +
        "bin. Aimed at `users` it would erase all 30 seeded users just as " +
        "cheerfully. The REAL bug is rarely typing {} on purpose: it is " +
        "`User.deleteMany(filter)` where filter was built from request data " +
        "and ended up empty. Defenses: validate filters before deleting, " +
        "refuse empty filters in shared helpers, prefer soft delete (module " +
        "07: set deletedAt instead of destroying data), and keep backups."
    );
    note(
      "deleteMany({}) empties a collection but KEEPS the collection and its " +
        "indexes; collection.drop() removes the whole thing, indexes included. " +
        "Both belong in clearly-marked scripts (like this repo's db:reset), " +
        "never in request handlers."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for @lesson.test docs and tmp_ collections");
    show("Removed", await removeTempData());
    note("The database is back to exactly its seeded state.");
  }
});
