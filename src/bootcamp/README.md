# The MongoDB Bootcamp — Curriculum Index

Work through the modules **in order** — each one builds on the previous. For
every module:

1. **Read the module's `README.md`** — that's the textbook chapter. It explains
   each concept: what it is, why it exists, when to use it, when to avoid it,
   the terms involved, common mistakes, and how it shows up in real MERN work.
2. **Run the lessons** in numeric order: `npm run lesson <module>/<file>`.
3. **Read the lesson source** while looking at its output — the comments
   explain every important operation.
4. **Experiment.** Change a filter, break something on purpose, re-run.
   `npm run db:seed` restores the data whenever you want a clean start.

> Before starting: complete the setup in the [root README](../../README.md)
> (install → `.env` → `npm run db:seed`).

---

## Phase 1 — Foundations (modules 01–03)

**[01-fundamentals](lessons/01-fundamentals/README.md)** — What MongoDB is;
documents, collections, databases; BSON vs JSON; ObjectId; every BSON data
type; how MongoDB compares to a relational database, concept by concept.
*Lessons: explore-the-database, bson-data-types, databases-and-collections.*

**[02-connections](lessons/02-connections/README.md)** — How this repo connects
to MongoDB; what a connection pool really is; pool size and busy-pool behavior;
connection lifecycle; graceful shutdown; why `import mongoose` works everywhere.
*Lessons: connection-lifecycle, connection-pool, graceful-shutdown.*

**[03-mongoose-basics](lessons/03-mongoose-basics/README.md)** — Schema vs
Model vs Document (the distinction everything else depends on); how a schema
becomes a model bound to a collection; every schema option; which rules Mongoose
enforces in Node vs which are true database guarantees.
*Lessons: schema-model-document, schema-options-playground,
validation-vs-db-constraints.*

## Phase 2 — Working with data (modules 04–08)

**[04-crud](lessons/04-crud/README.md)** — Every create/read/update/delete
operation Mongoose offers, what each returns, and the differences between
near-identical operations (`updateOne` vs `findOneAndUpdate`,
`countDocuments` vs `estimatedDocumentCount`, ...).
*Lessons: create, read, update, delete.*

**[05-querying](lessons/05-querying/README.md)** — Comparison, logical,
element, and array operators; querying nested documents with dot notation;
`$elemMatch`; regex matching and its performance rules.
*Lessons: comparison-operators, logical-operators, element-and-type-operators,
array-queries, nested-documents, regex-and-strings.*

**[06-projection-sorting-pagination](lessons/06-projection-sorting-pagination/README.md)**
— Returning only the fields you need; sorting (including ties and multi-field
sorts); page-number pagination and cursor pagination, and why big `skip`s get
slow.
*Lessons: projection, sorting, pagination-skip-limit, pagination-cursor.*

**[07-updates-and-deletes](lessons/07-updates-and-deletes/README.md)** — All
field and array update operators; positional updates; why single-document
updates are atomic and how that prevents overselling; soft delete vs hard
delete.
*Lessons: field-update-operators, array-update-operators, atomic-updates,
soft-delete.*

**[08-arrays-and-nested-documents](lessons/08-arrays-and-nested-documents/README.md)**
— Day-to-day work with embedded objects and arrays of objects; updating deep
paths; how deep is too deep.
*Lessons: embedded-documents, arrays-of-objects, deep-nesting.*

## Phase 3 — Designing data (modules 09–10)

**[09-data-modeling](lessons/09-data-modeling/README.md)** — The most important
chapter: embedding vs referencing; one-to-one, one-to-many, many-to-many,
parent-child; denormalization and deliberate duplication; cardinality;
designing around your queries instead of around normal forms.
*Lessons: embedding-vs-referencing, relationships-tour,
denormalization-in-action.*

**[10-populate-and-lean](lessons/10-populate-and-lean/README.md)** — What
`populate()` actually does under the hood (it is *not* a join), every populate
option that matters, and `lean()` — what you gain and what you give up.
*Lessons: populate-basics, populate-advanced, lean.*

## Phase 4 — Analytics & speed (modules 11–12)

**[11-aggregation](lessons/11-aggregation/README.md)** — The aggregation
pipeline from first principles through `$group`, a deep treatment of `$unwind`
and `$lookup`, expressions, and `$facet`/`$bucket`/`$sample` — all on realistic
store analytics (revenue by month, top products, top customers).
*Lessons: pipeline-basics, group, unwind, lookup, expressions,
facet-bucket-sample.*

**[12-indexes-and-performance](lessons/12-indexes-and-performance/README.md)**
— What an index is; every index type; compound-index prefix rules; reading
`explain()` plans (COLLSCAN vs IXSCAN); text search; a practical performance
checklist with measurements.
*Lessons: explain-basics, index-types, compound-indexes-and-sort, text-search,
performance-patterns.*

## Phase 5 — Robustness (modules 13–16)

**[13-validation-middleware-virtuals](lessons/13-validation-middleware-virtuals/README.md)**
— Validators (built-in, custom, create-vs-update); pre/post middleware and the
document-vs-query `this` trap; getters, setters, virtuals, and `toJSON`
transforms for clean API responses.
*Lessons: validation, middleware, virtuals-getters-setters.*

**[14-transactions-and-concurrency](lessons/14-transactions-and-concurrency/README.md)**
— Sessions and multi-document transactions (manual and `withTransaction`);
when you *don't* need them; race conditions and optimistic concurrency; write
and read concerns. Includes local replica-set setup instructions.
*Lessons: sessions-and-transactions, with-transaction,
concurrency-and-versioning, write-read-concerns.*

**[15-errors-and-query-behavior](lessons/15-errors-and-query-behavior/README.md)**
— Triggering and correctly handling every common error (ValidationError,
CastError, E11000, connection errors); how Mongoose queries really execute
(thenables, `exec()`, chaining, `clone()`).
*Lessons: common-errors, query-behavior.*

**[16-native-driver-and-utilities](lessons/16-native-driver-and-utilities/README.md)**
— The raw MongoDB driver vs Mongoose, side by side; collection/database admin
operations; why destructive operations live in clearly-marked scripts.
*Lessons: native-vs-mongoose, utility-operations.*

## Phase 6 — The real world (modules 17–18)

**[17-api-patterns](lessons/17-api-patterns/README.md)** — A runnable Express
API (`npm run bootcamp:api`) that puts everything together: filtered/sorted/
paginated product listings, text search, order placement with stock control,
and aggregation-powered dashboard endpoints.
*Code: [src/bootcamp/api/](api/).*

**[18-production-and-security](lessons/18-production-and-security/README.md)**
— NoSQL injection and how to prevent it; safe query patterns; secrets handling;
replica sets, failover, read preferences, and sharding at a working-knowledge
level.
*Lessons: query-injection, safe-patterns.*

---

## Where things live

| Piece | Path | Why it's separate |
| --- | --- | --- |
| Connection | [src/db/loader.db.js](../db/loader.db.js) | one place opens/closes the pool |
| Models | [src/models/](../models/) | schemas are shared by app, seeders, lessons |
| Seed data generation | [src/seeders/data/](../seeders/data/) | pure functions, no DB access |
| Seed/reset scripts | [src/seeders/](../seeders/) | the only writers; destructive ops isolated |
| Lesson helpers | [lib/lesson-runner.js](lib/lesson-runner.js) | hides only connect/print noise |
| Lessons | [lessons/](lessons/) | one folder per topic, independent |
