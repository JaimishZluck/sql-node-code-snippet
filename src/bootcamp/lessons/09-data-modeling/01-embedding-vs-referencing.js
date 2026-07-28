/**
 * LESSON 09-data-modeling/01-embedding-vs-referencing — One dataset, two shapes
 *
 * The core modeling decision, made tangible: the SAME blog data (posts +
 * comments + authors) is built TWICE in temp collections — once with comments
 * EMBEDDED inside each post, once with comments REFERENCED in their own
 * collection. Then the same workload runs against both shapes: the post-page
 * read (1 query vs 2), a comment thread going viral (unbounded growth,
 * measured in real BSON bytes against the 16 MB cap), and an author renaming
 * herself (the shared-data update problem). Neither shape wins everything —
 * that is the lesson.
 *
 * SAFETY: everything this file writes lives in temp collections
 * `tmp_blog_embedded`, `tmp_blog_posts`, `tmp_blog_comments`,
 * `tmp_blog_authors` — swept at the start (in case a previous run crashed)
 * and DROPPED in a finally-block cleanup. Seeded collections are never
 * touched.
 *
 * Run it with:  npm run lesson 09-data-modeling/01-embedding-vs-referencing
 */
import mongoose from "mongoose";
import { BSON } from "mongodb"; // the driver's BSON tools — for real document sizes
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";

// ---------------------------------------------------------------------
// DESIGN A — EMBEDDED: a post document carries its comments inside it.
// Each comment is a sub-document; the author's display name is COPIED in
// (there is no other option — the author herself is shared data and cannot
// live inside one post, so embedding forces a copy of whatever we show).
const embeddedCommentSchema = new mongoose.Schema(
  {
    authorName: { type: String, required: true },
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false } // comments here are never addressed individually
);

const tmpPostEmbeddedSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: String,
    comments: [embeddedCommentSchema],
  },
  { collection: "tmp_blog_embedded", versionKey: false }
);
const TmpPostEmbedded =
  mongoose.models.TmpPostEmbedded ||
  mongoose.model("TmpPostEmbedded", tmpPostEmbeddedSchema);

// ---------------------------------------------------------------------
// DESIGN B — REFERENCED: three flat collections.
//  - posts hold NO comment data at all
//  - authors are the single source of truth for a person's name
//  - comments reference BOTH: `post` (which thread am I in?) and `author`
//    (who wrote me?), plus a deliberate COPY of authorName for display —
//    real apps duplicate small display fields on purpose (lesson 03 is
//    entirely about living with such copies).
const tmpAuthorSchema = new mongoose.Schema(
  { displayName: { type: String, required: true } },
  { collection: "tmp_blog_authors", versionKey: false }
);
const TmpAuthor =
  mongoose.models.TmpAuthor || mongoose.model("TmpAuthor", tmpAuthorSchema);

const tmpPostSchema = new mongoose.Schema(
  { title: { type: String, required: true }, body: String },
  { collection: "tmp_blog_posts", versionKey: false }
);
const TmpPost =
  mongoose.models.TmpPost || mongoose.model("TmpPost", tmpPostSchema);

const tmpCommentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "TmpPost", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "TmpAuthor", required: true },
    authorName: { type: String, required: true }, // deliberate display copy
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { collection: "tmp_blog_comments", versionKey: false }
);
// A reference is only as good as its index: "comments of post X, newest
// first" must be an index walk, not a collection scan. Same idea as the
// seeded { product: 1, createdAt: -1 } index on reviews.
tmpCommentSchema.index({ post: 1, at: -1 });
const TmpComment =
  mongoose.models.TmpComment || mongoose.model("TmpComment", tmpCommentSchema);

const TMP_COLLECTIONS = [
  "tmp_blog_embedded",
  "tmp_blog_posts",
  "tmp_blog_comments",
  "tmp_blog_authors",
];

/** DESTRUCTIVE — but only for the four tmp_ collections this lesson owns. */
async function dropTempCollections() {
  const result = {};
  for (const name of TMP_COLLECTIONS) {
    try {
      await mongoose.connection.dropCollection(name);
      result[name] = "dropped";
    } catch {
      result[name] = "did not exist"; // NamespaceNotFound — fine
    }
  }
  return result;
}

const POST_1 = "How to choose a laptop in 2026";
const POST_2 = "Are wireless headphones worth it?";

await runLesson("Data modeling 1/3 — Embedding vs referencing", async () => {
  section("0. Safety sweep — clear temp collections a crashed run left behind");
  show("Temp collections cleared (did-not-exist is normal)", await dropTempCollections());

  try {
    // ------------------------------------------------------------------
    section("1. Build the SAME blog data in two shapes");
    // Three authors; Asha comments on BOTH posts — she is SHARED data, and
    // that fact powers section 4.
    const base = Date.parse("2026-07-01T10:00:00Z");
    const minutes = (n) => new Date(base + n * 60_000);
    const rawComments = [
      { post: POST_1, authorName: "Asha Rao", text: "Great checklist — the RAM advice saved me.", at: minutes(5) },
      { post: POST_1, authorName: "Vikram Shah", text: "Would add: check the keyboard before buying.", at: minutes(12) },
      { post: POST_1, authorName: "Meera Iyer", text: "Bought the Volt ProBook after reading this.", at: minutes(30) },
      { post: POST_2, authorName: "Asha Rao", text: "Battery life claims are always optimistic.", at: minutes(45) },
      { post: POST_2, authorName: "Vikram Shah", text: "Worth it for commutes, not for studios.", at: minutes(60) },
    ];

    // DESIGN A: one create per post, comments nested right in.
    await TmpPostEmbedded.create([
      {
        title: POST_1,
        body: "CPU, RAM, battery — what actually matters.",
        comments: rawComments.filter((c) => c.post === POST_1)
          .map(({ authorName, text, at }) => ({ authorName, text, at })),
      },
      {
        title: POST_2,
        body: "Honest pros and cons after a year of use.",
        comments: rawComments.filter((c) => c.post === POST_2)
          .map(({ authorName, text, at }) => ({ authorName, text, at })),
      },
    ]);

    // DESIGN B: authors first (their _ids must exist before comments can
    // reference them) — the same insert-parents-first dance the seeder does
    // for categories -> products.
    const authors = await TmpAuthor.create([
      { displayName: "Asha Rao" },
      { displayName: "Vikram Shah" },
      { displayName: "Meera Iyer" },
    ]);
    const authorByName = new Map(authors.map((a) => [a.displayName, a._id]));

    const [post1, post2] = await TmpPost.create([
      { title: POST_1, body: "CPU, RAM, battery — what actually matters." },
      { title: POST_2, body: "Honest pros and cons after a year of use." },
    ]);
    const postByTitle = new Map([[POST_1, post1._id], [POST_2, post2._id]]);

    await TmpComment.create(
      rawComments.map((c) => ({
        post: postByTitle.get(c.post),
        author: authorByName.get(c.authorName),
        authorName: c.authorName, // the display copy
        text: c.text,
        at: c.at,
      }))
    );

    show("Design A — one embedded post document", await TmpPostEmbedded.findOne({ title: POST_1 }).lean());
    show("Design B — the same data, spread over three collections", {
      post: await TmpPost.findOne({ title: POST_1 }).lean(),
      comments: await TmpComment.find({ post: post1._id }).select("authorName text at -_id").lean(),
      authors: authors.map((a) => ({ _id: a._id, displayName: a.displayName })),
    });
    note(
      "Identical information, two physical layouts. Design A pre-joined the " +
        "data at WRITE time (comments live inside their post); Design B kept " +
        "every piece separate and will pay to reassemble at READ time. " +
        "Everything else in this lesson is the bill for each choice."
    );

    // ------------------------------------------------------------------
    section("2. The read pattern — render the post page");
    // Design A: the page is ONE query. The document arrives pre-assembled —
    // no join, no second round trip, and the post + comments are a single
    // consistent unit (one document read is atomic).
    const pageA = await TmpPostEmbedded.findOne({ title: POST_1 }).lean();
    show("Design A: 1 query, page complete", {
      title: pageA.title,
      comments: pageA.comments.map((c) => `${c.authorName}: ${c.text}`),
    });

    // Design B: the page is TWO queries, plus app code to stitch them.
    // Query 2 rides the { post: 1, at: -1 } index — filter and sort in one
    // index walk.
    const postB = await TmpPost.findOne({ title: POST_1 }).lean();
    const commentsB = await TmpComment.find({ post: postB._id })
      .sort({ at: -1 })
      .select("authorName text -_id")
      .lean();
    show("Design B: 2 queries + assembly in app code", {
      title: postB.title,
      comments: commentsB.map((c) => `${c.authorName}: ${c.text}`),
    });
    note(
      "This is embedding's headline win: data read together, stored " +
        "together, ONE round trip. Design B paid two queries (or one " +
        "$lookup aggregation — still a join, just server-side). Per page " +
        "view that difference is milliseconds; at thousands of views per " +
        "minute it is real capacity. If this were the ONLY workload, " +
        "Design A would simply win. It is not the only workload."
    );

    // ------------------------------------------------------------------
    section("3. Problem 1 for embedding — the comment count grows FOREVER");
    // Post 1 goes viral. 1,500 new comments arrive. In Design A every one
    // of them is $push-ed INTO the same post document. (One update with
    // $each — but the document grows by every byte.)
    const viralComments = Array.from({ length: 1500 }, (_, i) => ({
      authorName: `Reader ${String(i + 1).padStart(4, "0")}`,
      text: "Nice post! Subscribed.",
      at: minutes(120 + i),
    }));

    const sizeBefore = BSON.calculateObjectSize(
      await TmpPostEmbedded.findOne({ title: POST_1 }).lean()
    );
    await TmpPostEmbedded.updateOne(
      { title: POST_1 },
      { $push: { comments: { $each: viralComments } } }
    );
    const grownPost = await TmpPostEmbedded.findOne({ title: POST_1 }).lean();
    const sizeAfter = BSON.calculateObjectSize(grownPost);
    const perComment = (sizeAfter - sizeBefore) / 1500;
    const LIMIT = 16 * 1024 * 1024; // MongoDB's hard per-document cap

    // Design B receives the exact same flood — as 1,500 tiny documents of
    // their own. The post document does not change by a single byte.
    await TmpComment.insertMany(
      viralComments.map((c) => ({
        post: postB._id,
        author: authorByName.get("Meera Iyer"), // stand-in author for readers
        ...c,
      }))
    );
    const postBSize = BSON.calculateObjectSize(await TmpPost.findOne({ _id: postB._id }).lean());

    show("The same 1,500 comments, absorbed by each design", {
      embedded: {
        postBytesBefore: sizeBefore,
        postBytesAfter: sizeAfter,
        approxBytesPerComment: Math.round(perComment),
        commentsUntil16MB: Math.floor((LIMIT - sizeAfter) / perComment),
      },
      referenced: {
        postBytes: postBSize, // unchanged — comments live elsewhere
        commentDocs: await TmpComment.countDocuments({ post: postB._id }),
      },
    });
    note(
      "'Grows with usage' is THE red flag for embedding. The embedded post " +
        "will physically stop accepting comments at 16 MB — a hard server " +
        "limit, not a config knob. Long before that: every page view ships " +
        "the whole ever-growing document over the wire, every $push rewrites " +
        "it in the storage engine, and every commenter contends on ONE " +
        "document (a document is the unit of locking). The referenced post " +
        "stays a few hundred bytes forever."
    );

    // Pagination pain, same story: "newest 5 comments" from the embedded
    // array needs a $slice projection — and $slice can only take from the
    // ends in stored order; find() cannot re-sort an embedded array for you.
    const lastFive = await TmpPostEmbedded.findOne(
      { title: POST_1 },
      { title: 1, comments: { $slice: -5 } } // last 5 elements, stored order
    ).lean();
    // Referenced: the exact page you want, sorted and limited BY THE INDEX.
    const newestFive = await TmpComment.find({ post: postB._id })
      .sort({ at: -1 })
      .limit(5)
      .select("authorName at -_id")
      .lean();
    show("Paginating comments", {
      embedded_slice: lastFive.comments.map((c) => c.authorName),
      referenced_page: newestFive.map((c) => c.authorName),
    });
    note(
      "$slice grabs from the array's ends in STORED order — fine while " +
        "comments happen to be appended chronologically, useless for 'top " +
        "voted' or any other order without re-sorting in JS after fetching " +
        "everything. The referenced design paginates any order that has an " +
        "index: .sort().skip()/.limit() or a range cursor (module 06)."
    );

    // ------------------------------------------------------------------
    section("4. Problem 2 for embedding — updating SHARED data");
    // Asha gets married and renames herself. Her display name exists as a
    // COPY inside every comment she ever wrote. How hard is the fix?
    const OLD_NAME = "Asha Rao";
    const NEW_NAME = "Asha Rao-Kapoor";

    // Design A: array surgery across EVERY post document that holds one of
    // her comments — arrayFilters targets the matching elements (module 08).
    const embeddedFix = await TmpPostEmbedded.updateMany(
      { "comments.authorName": OLD_NAME },
      { $set: { "comments.$[c].authorName": NEW_NAME } },
      { arrayFilters: [{ "c.authorName": OLD_NAME }] }
    );
    show("Design A rename — array surgery in every affected post", {
      matchedPosts: embeddedFix.matchedCount, // 2 — she commented on both posts
      modifiedPosts: embeddedFix.modifiedCount,
    });
    note(
      "It worked — but look at what it took: MongoDB had to find every POST " +
        "containing her comments, then edit inside each one's array, " +
        "rewriting those (now large) documents. Across documents this is NOT " +
        "atomic — a reader mid-update sees her old name on one post and new " +
        "on another. Worst of all, YOU must remember every place the name " +
        "was ever copied; miss one collection and it silently keeps the old " +
        "name forever."
    );

    // Design B, option 1: the name copy lives in ONE flat collection —
    // one updateMany over small documents, helped by an index if you add
    // one on authorName.
    const flatFix = await TmpComment.updateMany(
      { authorName: OLD_NAME },
      { $set: { authorName: NEW_NAME } }
    );
    show("Design B rename, option 1 — one flat updateMany on the copies", {
      matchedComments: flatFix.matchedCount, // her 2 comments
      modifiedComments: flatFix.modifiedCount,
    });

    // Design B, option 2 — the option embedding can NEVER offer: because
    // comments also carry the author's ObjectId, the source of truth is ONE
    // document. Fix it there and every reader that joins sees the new name.
    await TmpAuthor.updateOne(
      { _id: authorByName.get(OLD_NAME) },
      { $set: { displayName: NEW_NAME } }
    );
    // Render post 2's comments the pure-reference way: 2nd query for
    // comments, 3rd for authors — the classic app-side join via $in + Map.
    const p2Comments = await TmpComment.find({ post: postByTitle.get(POST_2) })
      .sort({ at: 1 })
      .select("author text")
      .lean();
    const authorDocs = await TmpAuthor.find({
      _id: { $in: p2Comments.map((c) => c.author) },
    }).lean();
    const nameById = new Map(authorDocs.map((a) => [String(a._id), a.displayName]));
    show(
      "Design B rename, option 2 — fix ONE author doc, every join sees it",
      p2Comments.map((c) => `${nameById.get(String(c.author))}: ${c.text}`)
    );
    note(
      "One updateOne on one small document — atomic, complete, impossible " +
        "to miss a copy, because there are no copies. The price: rendering " +
        "now needs the author lookup (a third query, or populate/$lookup). " +
        "That is the whole normalization trade in miniature: truth in one " +
        "place = cheap writes + join-on-read; copies everywhere = cheap " +
        "reads + fan-out writes. Embedding shared data locks you into the " +
        "copies end WITH the worst update ergonomics (array surgery inside " +
        "many parents) — which is why 'is it SHARED?' is one of the five " +
        "modeling questions."
    );

    // ------------------------------------------------------------------
    section("5. The verdict — scoring comments on the five questions");
    note(
      "Owned? YES, a comment belongs to one post (pro-embed). Read " +
        "together? YES, the post page shows both (pro-embed). Bounded? NO — " +
        "comments grow with popularity, forever (reference). Shared data " +
        "inside? YES — the author (reference). Updated independently? YES — " +
        "edits, deletions, vote counts (reference). Three strikes: real " +
        "blog engines put comments in their own collection, exactly like " +
        "our seeded reviews live outside products. The popular HYBRID: keep " +
        "the full comment collection AND embed the newest handful in the " +
        "post as a preview (the subset pattern) — read speed for the common " +
        "case, correctness for the rest, at the price of one small cache to " +
        "resync (lesson 03's topic)."
    );
  } finally {
    // finally-block cleanup: runs even if a section above threw.
    section("Cleanup — DESTRUCTIVE, but only for the tmp_blog_* collections");
    show("Dropped", await dropTempCollections());
    note("The database is back to exactly its seeded state.");
  }
});
