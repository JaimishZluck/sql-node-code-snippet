# MongoDB Bootcamp (Node.js + Mongoose)

A complete, hands-on MongoDB course built into a real Node.js/Express codebase.
You study it **topic by topic**: every module has a `README.md` that teaches the
concepts, plus runnable lesson scripts that demonstrate them against a realistic
seeded e-commerce database (users, categories, products, orders, reviews).

The goal is not to memorize syntax. Every lesson explains **what** an operation
does, **why** it exists, **when** to use it, and **what happens internally** —
the way an experienced MERN developer would explain it.

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 18+ (tested on 24) | `node --version` |
| MongoDB | 6.0+ | any ONE of the options below |
| mongosh (optional) | any | handy for inspecting the DB yourself |

**Option A — local MongoDB (recommended for the course)**
Install MongoDB Community Server from mongodb.com/try/download/community and make
sure it is running (Windows: the "MongoDB" service; macOS/Linux: `mongod`).

**Option B — Docker**

```bash
docker run -d --name mongo-bootcamp -p 27017:27017 mongo:7
```

**Option C — MongoDB Atlas (free cloud cluster)**
Create a free M0 cluster, allow your IP, and use the `mongodb+srv://...`
connection string in your `.env`.

> **Transactions note:** module 14 (transactions) needs a **replica set** —
> a plain single `mongod` won't run transactions. Atlas clusters are replica
> sets already. For a local setup, module 14's README shows how to start a
> one-node replica set in two commands. Every other module works fine on a
> standalone server, and the transaction lessons detect a standalone server
> and print instructions instead of crashing.

## 2. Setup

```bash
# 1. install dependencies
npm install

# 2. create your environment file
copy .env.example .env      # Windows
cp .env.example .env        # macOS / Linux / Git Bash

# 3. fill the database with realistic sample data
npm run db:seed
```

The default `.env` points at `mongodb://127.0.0.1:27017`, database
`mongo_bootcamp`. Edit `MONGO_URI` if you use Docker with a different port or
Atlas. **Never commit `.env`** — it is git-ignored on purpose (secrets live in
environment variables, not in code).

## 3. Running lessons

```bash
npm run lesson                       # list every lesson
npm run lesson 04-crud               # list the lessons in one module
npm run lesson 04-crud/01-create     # run one lesson
npm run lesson 11                    # module number prefix works too
```

Each lesson connects to MongoDB, prints its output in clearly-marked sections
with explanations, and disconnects. Read the module's `README.md` first, then
run its lessons in order, then read the lesson source — the comments in the
code are part of the course.

Lessons are safe to run **in any order, repeatedly**. Read-only lessons query
the seeded data; lessons that write use clearly-marked temporary documents and
clean up after themselves.

## 4. Seeding, resetting, reseeding

| Command | What it does |
| --- | --- |
| `npm run db:seed` | Clears the 5 bootcamp collections and refills them with fresh sample data (repeatable — run any time). |
| `npm run db:reset` | **Destructive:** drops the 5 collections entirely (documents *and* indexes). |
| `npm run db:reseed` | Reset, then seed — a truly clean slate. |

The seeded database contains **30 users, 10 categories (2-level tree),
63 products, 300 orders spread over the last year, and 200 reviews** — enough
volume and variety for pagination, sorting, grouping, `$lookup`, indexing, and
aggregation to be meaningful. Data generation lives in
[src/seeders/data/](src/seeders/data/) (pure functions, deterministic), and the
only code that writes to the DB is [seed.js](src/seeders/seed.js).

## 5. The curriculum

The full course lives in [src/bootcamp/](src/bootcamp/) — start with the
[curriculum index](src/bootcamp/README.md). Summary:

| # | Module | You will learn |
| --- | --- | --- |
| 01 | [Fundamentals](src/bootcamp/lessons/01-fundamentals/README.md) | Documents, BSON, ObjectId, MongoDB vs SQL, data types |
| 02 | [Connections](src/bootcamp/lessons/02-connections/README.md) | Connection pooling, lifecycle, graceful shutdown |
| 03 | [Mongoose basics](src/bootcamp/lessons/03-mongoose-basics/README.md) | Schema vs Model vs Document, every schema option |
| 04 | [CRUD](src/bootcamp/lessons/04-crud/README.md) | Every create/read/update/delete operation |
| 05 | [Querying](src/bootcamp/lessons/05-querying/README.md) | All query operators, arrays, nested docs, regex |
| 06 | [Projection, sorting, pagination](src/bootcamp/lessons/06-projection-sorting-pagination/README.md) | Shaping results, page-number + cursor pagination |
| 07 | [Updates & deletes](src/bootcamp/lessons/07-updates-and-deletes/README.md) | Update operators, atomicity, soft delete |
| 08 | [Arrays & nested documents](src/bootcamp/lessons/08-arrays-and-nested-documents/README.md) | Working with embedded data day-to-day |
| 09 | [Data modeling](src/bootcamp/lessons/09-data-modeling/README.md) | Embed vs reference, relationships, denormalization |
| 10 | [Populate & lean](src/bootcamp/lessons/10-populate-and-lean/README.md) | References, populate mechanics, lean queries |
| 11 | [Aggregation](src/bootcamp/lessons/11-aggregation/README.md) | Pipelines, $group, $unwind, $lookup, $facet, expressions |
| 12 | [Indexes & performance](src/bootcamp/lessons/12-indexes-and-performance/README.md) | Index types, explain(), text search, optimization |
| 13 | [Validation, middleware, virtuals](src/bootcamp/lessons/13-validation-middleware-virtuals/README.md) | Validators, hooks, getters/setters, transforms |
| 14 | [Transactions & concurrency](src/bootcamp/lessons/14-transactions-and-concurrency/README.md) | Sessions, transactions, races, write/read concerns |
| 15 | [Errors & query behavior](src/bootcamp/lessons/15-errors-and-query-behavior/README.md) | Every common error + how Mongoose queries execute |
| 16 | [Native driver & utilities](src/bootcamp/lessons/16-native-driver-and-utilities/README.md) | Driver vs ODM, collection/database admin ops |
| 17 | [API patterns](src/bootcamp/lessons/17-api-patterns/README.md) | A real Express API: filtering, search, dashboards |
| 18 | [Production & security](src/bootcamp/lessons/18-production-and-security/README.md) | Injection, safe patterns, replica sets, sharding |

Module 17 is a runnable Express API (`npm run bootcamp:api`, then open
`http://localhost:4100/api/products?minPrice=1000&sort=price-desc`).

## 6. Repository structure

```
src/
  index.js                  # main Express app entry (the original app template)
  config/env.config.js      # validated environment configuration
  db/loader.db.js           # THE database connection (connect/disconnect + pooling)
  db/operations.db.js       # reusable query helpers used by the app template
  models/                   # Mongoose models = the schema layer
    user.model.js             # + category, product, order, review
    schemas/address.schema.js # reusable embedded sub-schema
  seeders/                  # sample-data generation (data/) + seed/reset scripts
  bootcamp/
    README.md               # curriculum index — START HERE
    lib/lesson-runner.js    # tiny connect/run/disconnect + print helpers
    run-lesson.js           # the `npm run lesson` launcher
    lessons/01-...18-...    # the 18 course modules
    api/                    # module 17's runnable Express API
  controllers/ services/ routes/ middlewares/ ...  # original app template layers
```

Connection logic, models, seeders, and lesson code are deliberately separated —
that separation is itself one of the things the course teaches.

## 7. The original app template

This repo started as a reusable backend starter (JWT auth, logging, rate
limiting, error handling). That app still works: `npm run dev` starts it (it
requires the same `.env`). The bootcamp reuses its connection layer and models
but runs independently of the HTTP server.
