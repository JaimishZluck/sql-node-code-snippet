/**
 * LESSON 08-arrays-and-nested-documents/03-deep-nesting — Deep nesting: powers, pain, and promotion
 *
 * MongoDB lets documents nest as deep as you like — objects in arrays in
 * objects in arrays. This lesson builds a realistic 3-level document
 * (warehouse -> zones[] -> racks[] -> bins[]) in a TEMP collection and uses
 * it to show BOTH sides honestly: how to query and update deep paths
 * (nested $elemMatch, arrayFilters chains), and then WHY this shape fights
 * you — context-blind dot paths, one-`$` limits, whole-document I/O, the
 * 16 MB document cap, unbounded growth — measured live with real BSON
 * sizes. It ends with the cure: PROMOTING the inner level to its own
 * collection, and the checklist for when embedding is the right call.
 *
 * SAFETY: everything mutable lives in temp collections `tmp_warehouses`
 * and `tmp_bins`, swept at the start and DROPPED in a finally-block
 * cleanup. Seeded collections are never touched.
 *
 * Run it with:  npm run lesson 08-arrays-and-nested-documents/03-deep-nesting
 */
import mongoose from "mongoose";
import { BSON } from "mongodb"; // the driver's BSON tools — for real document sizes
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";

// ---------------------------------------------------------------------
// The DEEP shape: warehouse -> zones[] -> racks[] -> bins[].
// Sub-schemas all disable _id to keep the output readable — the depth is
// the lesson here, not subdocument ids (lesson 02 covered those).
const binSchema = new mongoose.Schema(
  { sku: { type: String, required: true }, qty: { type: Number, default: 0, min: 0 } },
  { _id: false }
);
const rackSchema = new mongoose.Schema(
  { code: { type: String, required: true }, bins: [binSchema] },
  { _id: false }
);
const zoneSchema = new mongoose.Schema(
  { code: { type: String, required: true }, label: String, racks: [rackSchema] },
  { _id: false }
);
const tmpWarehouseSchema = new mongoose.Schema(
  { name: { type: String, required: true }, zones: [zoneSchema] },
  { collection: "tmp_warehouses", versionKey: false }
);
const TmpWarehouse =
  mongoose.models.TmpWarehouse || mongoose.model("TmpWarehouse", tmpWarehouseSchema);

// The FLAT shape the deep one gets promoted to in section 5: one document
// per bin, with the former nesting levels as plain indexed fields.
const tmpBinSchema = new mongoose.Schema(
  {
    warehouse: { type: String, required: true },
    zone: { type: String, required: true },
    rack: { type: String, required: true },
    sku: { type: String, required: true },
    qty: { type: Number, default: 0, min: 0 },
  },
  { collection: "tmp_bins", versionKey: false }
);
// One compound index answers every lookup the nested shape struggled with.
tmpBinSchema.index({ warehouse: 1, zone: 1, rack: 1, sku: 1 }, { unique: true });
const TmpBin = mongoose.models.TmpBin || mongoose.model("TmpBin", tmpBinSchema);

/** DESTRUCTIVE — but only for the two tmp_ collections this lesson owns. */
async function dropTempCollections() {
  const result = {};
  for (const name of ["tmp_warehouses", "tmp_bins"]) {
    try {
      await mongoose.connection.dropCollection(name);
      result[name] = "dropped";
    } catch {
      result[name] = "did not exist"; // NamespaceNotFound — fine
    }
  }
  return result;
}

await runLesson("Arrays & nested docs 3/3 — Deep nesting & promotion", async () => {
  section("0. Safety sweep + build the 3-level practice document");
  show("Temp collections cleared (did-not-exist is normal)", await dropTempCollections());

  try {
    // One warehouse, two zones, two racks each, a few bins per rack.
    // Note COOK-7781 lives ONLY in zone B — that's the bait for section 2.
    const wh = await TmpWarehouse.create({
      name: "Surat Fulfillment Center",
      zones: [
        {
          code: "A",
          label: "pick floor",
          racks: [
            { code: "A-R1", bins: [{ sku: "LAP-9001", qty: 12 }, { sku: "ACC-3305", qty: 40 }] },
            { code: "A-R2", bins: [{ sku: "LAP-9001", qty: 5 }, { sku: "HDP-2210", qty: 18 }] },
          ],
        },
        {
          code: "B",
          label: "bulk storage",
          racks: [
            { code: "B-R1", bins: [{ sku: "COOK-7781", qty: 60 }, { sku: "HDP-2210", qty: 25 }] },
            { code: "B-R2", bins: [{ sku: "BOOK-5520", qty: 90 }] },
          ],
        },
      ],
    });
    show("Warehouse created", { _id: wh._id, zones: wh.zones.length });

    // ------------------------------------------------------------------
    section("1. Reading & querying deep paths");
    // In JavaScript, depth is just chained access (with ?. in real code —
    // any level can be missing):
    show("wh.zones[1].racks[0].bins[0] — pure JS access", wh.zones[1].racks[0].bins[0]);

    // In a FILTER, one dotted path walks through every array level: this
    // asks "does ANY zone have ANY rack with ANY bin holding this SKU?".
    const hasSku = await TmpWarehouse.countDocuments({ "zones.racks.bins.sku": "HDP-2210" });
    show("Warehouses containing HDP-2210 anywhere (dot path)", hasSku);
    note(
      "The dot path 'zones.racks.bins.sku' fans out across all three array " +
        "levels at once — powerful for 'exists anywhere?' questions, and " +
        "completely blind to WHERE the match was. That blindness is the next " +
        "section's trap."
    );

    // ------------------------------------------------------------------
    section("2. The context trap — conditions match across DIFFERENT branches");
    // COOK-7781 is stocked ONLY in zone B. Ask the naive question 'is
    // COOK-7781 in zone A?' with two dot conditions:
    const naive = await TmpWarehouse.countDocuments({
      "zones.code": "A",
      "zones.racks.bins.sku": "COOK-7781",
    });
    show("NAIVE { 'zones.code': 'A', 'zones...sku': 'COOK-7781' }", naive); // 1 — WRONG

    // Each condition independently asks "does ANY zone satisfy me?" — zone A
    // satisfies the first, zone B satisfies the second, document matches.
    // The module-05 cross-element trap, now compounding at EVERY level.
    // Pinning context takes nested $elemMatch, one per level you care about:
    const correctA = await TmpWarehouse.countDocuments({
      zones: { $elemMatch: { code: "A", "racks.bins.sku": "COOK-7781" } },
    });
    const correctB = await TmpWarehouse.countDocuments({
      zones: { $elemMatch: { code: "B", "racks.bins.sku": "COOK-7781" } },
    });
    show("$elemMatch pins the zone", { "in zone A": correctA, "in zone B": correctB }); // 0 and 1
    note(
      "The naive filter said COOK-7781 is in zone A — silently wrong, " +
        "plausible-looking, straight into a bad report. And notice what even " +
        "the CORRECT query returns: the WHOLE warehouse document. MongoDB " +
        "matches documents, so 'which rack? which bin? what qty?' still " +
        "means re-searching the arrays in JS (or an aggregation $unwind " +
        "chain). Every nesting level makes both asking and answering harder."
    );

    // ------------------------------------------------------------------
    section("3. Updating deep paths — numeric indexes vs arrayFilters chains");
    // Option 1: hard-code the position. Legal, and BRITTLE — the path is
    // 'whatever sits at those indexes today', not 'the bin I mean'.
    await TmpWarehouse.updateOne(
      { _id: wh._id },
      { $set: { "zones.0.racks.0.bins.1.qty": 35 } } // zone A / rack A-R1 / ACC-3305
    );
    note(
      "'zones.0.racks.0.bins.1.qty' works until ONE insert, delete, or " +
        "reorder shifts the arrays — then it silently updates the WRONG bin. " +
        "Numeric paths belong in one-off shell fixes, not application code."
    );

    // Option 2: arrayFilters — one named filter PER LEVEL, addressing the
    // element by WHAT it is, not where it sits. This is the real tool:
    await TmpWarehouse.updateOne(
      { _id: wh._id },
      { $inc: { "zones.$[z].racks.$[r].bins.$[b].qty": -2 } }, // picked 2 units
      { arrayFilters: [{ "z.code": "A" }, { "r.code": "A-R2" }, { "b.sku": "LAP-9001" }] }
    );
    const afterInc = await TmpWarehouse.findById(wh._id);
    show(
      "Zone A after both updates (ACC-3305: 40 -> 35; A-R2's LAP-9001: 5 -> 3)",
      afterInc.zones[0].racks.map((r) => ({ rack: r.code, bins: r.bins }))
    );

    // And the tool you might REACH for first — the positional `$` — cannot
    // do this at all. `$` may appear only ONCE in a path; it cannot
    // traverse nested arrays:
    try {
      await TmpWarehouse.updateOne(
        { "zones.racks.bins.sku": "HDP-2210" },
        { $inc: { "zones.$.racks.$.bins.$.qty": 1 } }
      );
      show("Single-$ across nested arrays", "unexpectedly succeeded?!");
    } catch (error) {
      show("Single-$ across nested arrays is rejected", error.message);
    }
    note(
      "Per the MongoDB docs, the positional $ 'cannot be used for queries " +
        "which traverse more than one array'. So every deep update needs an " +
        "arrayFilters entry per level — verbose at depth 3, unmanageable " +
        "deeper. Update complexity grows WITH nesting depth; flat documents " +
        "keep it constant."
    );

    // ------------------------------------------------------------------
    section("4. Why deep nesting hurts — measured, not preached");
    // Real BSON size of the document right now (calculateObjectSize is the
    // driver's own serializer doing a dry run):
    const sizeBefore = BSON.calculateObjectSize(afterInc.toObject());

    // Now simulate six months of business: bulk storage keeps receiving new
    // SKUs. 500 more bins into zone B / rack B-R2 — on the TEMP doc only:
    const bulkBins = Array.from({ length: 500 }, (_, i) => ({
      sku: `BULK-${String(i + 1).padStart(4, "0")}`,
      qty: 1,
    }));
    await TmpWarehouse.updateOne(
      { _id: wh._id },
      { $push: { "zones.$[z].racks.$[r].bins": { $each: bulkBins } } },
      { arrayFilters: [{ "z.code": "B" }, { "r.code": "B-R2" }] }
    );
    const grown = await TmpWarehouse.findById(wh._id);
    const sizeAfter = BSON.calculateObjectSize(grown.toObject());
    const perBin = (sizeAfter - sizeBefore) / 500;
    const LIMIT = 16 * 1024 * 1024; // MongoDB's hard per-document cap
    show("Document size — the 16 MB wall is real", {
      bytesBefore: sizeBefore,
      bytesAfter500MoreBins: sizeAfter,
      approxBytesPerBin: Math.round(perBin),
      binsUntil16MB: Math.floor((LIMIT - sizeAfter) / perBin),
    });
    note(
      "Half a million-ish bins and this document physically cannot be " +
        "saved — 16 MB is a hard server limit, not a config knob. Long " +
        "before that wall, the shape already hurts: (1) GROWTH — bins grow " +
        "with business activity, and 'grows forever' inside one document is " +
        "the number-one modeling red flag; (2) I/O — reading 'one bin' " +
        "ships the whole multi-KB (someday multi-MB) document over the " +
        "wire, and every tiny $inc rewrites it in the storage engine; " +
        "(3) CONCURRENCY — the document is the unit of atomicity, so every " +
        "picker updating any bin contends on ONE document; (4) INDEXING — " +
        "a multikey index on 'zones.racks.bins.sku' is legal but makes one " +
        "entry per bin per doc, index selectivity collapses (every query " +
        "still lands on the same giant doc), and compound multikey indexes " +
        "cannot span parallel (sibling) arrays at all."
    );

    // ------------------------------------------------------------------
    section("5. The cure — PROMOTE the inner level to its own collection");
    // The migration pattern: flatten each bin into its own small document,
    // carrying its former ancestry (zone, rack) as plain fields.
    const flatBins = grown.zones.flatMap((z) =>
      z.racks.flatMap((r) =>
        r.bins.map((b) => ({
          warehouse: grown.name,
          zone: z.code,
          rack: r.code,
          sku: b.sku,
          qty: b.qty,
        }))
      )
    );
    await TmpBin.insertMany(flatBins);
    show("tmp_bins after promotion", { flatDocuments: await TmpBin.countDocuments() });

    // Section 3's arrayFilters gymnastics, replayed on the flat shape:
    await TmpBin.updateOne(
      { zone: "A", rack: "A-R2", sku: "LAP-9001" },
      { $inc: { qty: 5 } } // restock 5 units — one flat filter, done
    );
    // Section 2's context question, replayed — precise answers, no $elemMatch:
    const where = await TmpBin.find({ sku: "HDP-2210" }).select("zone rack qty -_id").lean();
    show("'Where is HDP-2210?' on the flat shape", where);
    note(
      "Compare line for line: the 3-filter arrayFilters update became " +
        "updateOne({ zone, rack, sku }, { $inc }) — plain fields, plain " +
        "filter, fully indexable ({ warehouse, zone, rack, sku } unique). " +
        "The location question returns EXACTLY the bins, not a document to " +
        "re-search. Each bin is now its own unit of concurrency and can " +
        "never hit a size wall. The former hierarchy didn't disappear — it " +
        "became data (zone/rack fields), which is what it always was. This " +
        "is the same reasoning that made reviews a collection instead of an " +
        "array inside Product (see the Review model header)."
    );

    // ------------------------------------------------------------------
    section("6. So when IS embedding right? The checklist");
    note(
      "Embed when ALL THREE hold: (1) OWNED — the inner data belongs to " +
        "exactly one parent and is meaningless alone (an order's line items, " +
        "a user's address); (2) BOUNDED — you can name a small, hard maximum " +
        "(items per order: dozens at most; addresses: a handful) — 'grows " +
        "with usage' fails this test; (3) READ TOGETHER — the common case " +
        "fetches parent and children as one unit (an invoice always shows " +
        "its lines). Our seeded models pass: address (1 level), order.items " +
        "(1 level of objects), specs (1 level). None nests 3 deep — that is " +
        "design, not coincidence. When any rule fails — shared, unbounded, " +
        "or independently queried/updated data — promote it to a collection " +
        "and reference (module 09 goes deep on these trade-offs)."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for tmp_warehouses / tmp_bins");
    show("Dropped", await dropTempCollections());
    note("The database is back to exactly its seeded state.");
  }
});
