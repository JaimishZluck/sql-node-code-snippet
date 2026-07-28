/**
 * LESSON 18-production-and-security/01-query-injection — NoSQL injection
 *
 * "MongoDB doesn't use SQL, so it can't be injected." That belief is why
 * NoSQL injection keeps working.
 *
 * MongoDB queries are OBJECTS, and objects arrive from clients as JSON. If
 * you drop a request value straight into a filter, an attacker can send an
 * OPERATOR instead of a value — turning `{ password: "guess" }` into
 * `{ password: { $ne: null } }`, which matches any password at all.
 *
 * This lesson performs those attacks against the seeded data (read-only —
 * nothing is written), then shows exactly what stops each one.
 *
 * 100% READ-ONLY — safe to run any time, in any order.
 *
 * Run it with:  npm run lesson 18-production-and-security/01-query-injection
 */
import mongoose from "mongoose";
import { runLesson, section, show, note } from "../../lib/lesson-runner.js";
import User from "../../../models/user.model.js";
import Product from "../../../models/product.model.js";

await runLesson("Production 1/2 — Query injection", async () => {
  // --------------------------------------------------------------------
  section("1. Why this is possible at all");
  note(
    "A MongoDB filter is a JavaScript OBJECT: { email: 'a@b.com' }. Express " +
      "parses a JSON body into an object too. So if you write " +
      "User.findOne({ email: req.body.email }) and the attacker sends " +
      '{"email": {"$ne": null}} as JSON, your filter becomes ' +
      "{ email: { $ne: null } } — a completely different query. No string " +
      "concatenation was involved, which is exactly why the SQL intuition " +
      "('I'm not building a string, so I'm safe') fails here."
  );

  // --------------------------------------------------------------------
  section("2. Attack 1 — operator injection in a login");
  // The vulnerable pattern, written as an Express handler would.
  const vulnerableLogin = async (body) => {
    // A real app would compare a hash; the shape of the bug is identical.
    return User.findOne({ email: body.email, isActive: body.isActive });
  };

  const honest = await vulnerableLogin({ email: (await User.findOne().lean()).email, isActive: true });
  show("A normal login attempt", { found: Boolean(honest), user: honest?.name });

  // The attacker sends operators instead of values.
  const attacked = await vulnerableLogin({ email: { $ne: null }, isActive: { $ne: false } });
  show("The SAME code with an injected payload", {
    payloadSent: '{"email": {"$ne": null}, "isActive": {"$ne": false}}',
    found: Boolean(attacked),
    "logged in as": attacked?.name,
    "their role": attacked?.role,
  });
  note(
    "The attacker knew no email and no password, and got a session as " +
      "whichever user happened to come first. With a $gt/$regex payload they " +
      "can walk the collection, and by targeting { role: 'admin' } they can " +
      "pick their victim. This is the single most common NoSQL injection, and " +
      "it takes one curl command."
  );

  // --------------------------------------------------------------------
  section("3. Attack 2 — regex denial of service");
  // $regex in a filter is powerful, and catastrophically backtracking
  // patterns are a real availability risk.
  const vulnerableSearch = (body) => Product.find({ name: body.name }).limit(5).lean();

  const normalSearch = await vulnerableSearch({ name: /laptop/i });
  show("A legitimate search", { matched: normalSearch.length });

  // A regex the attacker controls entirely. Even a simple one forces a full
  // collection scan; a nested-quantifier pattern can pin a CPU core.
  const injectedRegex = await vulnerableSearch({ name: { $regex: ".*", $options: "i" } });
  show("An injected regex", {
    payloadSent: '{"name": {"$regex": ".*", "$options": "i"}}',
    matched: injectedRegex.length,
    "what it did": "matched everything — an unindexed full collection scan",
    "worse payloads": '{"$regex": "^(a+)+$"} — catastrophic backtracking, CPU pinned',
  });
  note(
    "Never let a client supply a raw regex. If you need prefix search, build " +
      "the regex yourself from an escaped string and anchor it: " +
      "new RegExp('^' + escapeRegex(term)) — anchored patterns can also use " +
      "an index (module 12). For real search, use $text."
  );

  // --------------------------------------------------------------------
  section("4. Attack 3 — $where and JavaScript execution");
  show("The $where operator", {
    what: "runs a JavaScript expression on the SERVER, per document",
    example: "{ $where: 'this.price > this.stock * 100' }",
    "why it is dangerous": [
      "the expression runs on the database server",
      "it cannot use an index — every document is evaluated",
      "if the string comes from a client, they choose the code",
      "'while(true){}' as a payload is a denial of service",
    ],
    "the fix": "$expr does the same field-comparison job safely and can sometimes use an index",
    "better still": "disable server-side JS entirely: mongod --noscripting",
  });
  // Show the SAFE equivalent rather than running $where at all.
  const safeComparison = await Product.find({
    $expr: { $gt: ["$price", { $multiply: ["$stock", 100] }] },
  })
    .limit(3)
    .select("name price stock")
    .lean();
  show("$expr — the safe way to compare two fields", safeComparison);

  // --------------------------------------------------------------------
  section("5. Defence 1 — Mongoose schemas already stop a lot of this");
  // Casting is a real defence: a schema-typed field rejects an object where
  // it expects a string.
  let castBlocked = null;
  try {
    // age is a Number in the schema, so an operator object cannot be cast.
    await User.findOne({ age: { $ne: "not-a-number" } });
    castBlocked = "the query ran (operators against a typed field are still valid syntax)";
  } catch (error) {
    castBlocked = { name: error.name, message: error.message.slice(0, 100) };
  }
  show("Schema casting vs injected values", {
    "operator objects": "still allowed — $ne on a Number field is legitimate query syntax",
    "type confusion": "blocked — a plain object where a String is expected throws CastError",
    "unknown fields in a filter": "sent to the server and match nothing (strict mode, module 15)",
    result: castBlocked,
  });
  note(
    "Schemas help but do NOT solve this. { email: { $ne: null } } is valid " +
      "against a String field — Mongoose has no way to know you did not mean " +
      "it. The real fix is to never let an object reach the filter in the " +
      "first place."
  );

  // --------------------------------------------------------------------
  section("6. Defence 2 — coerce the type at the boundary");
  const safeLogin = async (body) => {
    // ONE line, and the whole class of attacks disappears. If the attacker
    // sends an object, String(...) turns it into "[object Object]" — which
    // matches nothing.
    const email = String(body.email ?? "").toLowerCase().trim();
    if (!email) return null;
    return User.findOne({ email, isActive: true });
  };

  const safeNormal = await safeLogin({ email: (await User.findOne().lean()).email });
  const safeAttack = await safeLogin({ email: { $ne: null } });
  show("The same login, with String() coercion", {
    "legitimate request": Boolean(safeNormal),
    "injected request": Boolean(safeAttack),
    "what the attacker's filter became": '{ email: "[object Object]" }',
  });
  note(
    "This is the highest-value defence and it costs nothing: coerce every " +
      "value to the type you expect before it reaches a query. String() for " +
      "strings, Number() for numbers (then check Number.isNaN), and an " +
      "explicit allow-list for enums."
  );

  // --------------------------------------------------------------------
  section("7. Defence 3 — validate the request shape");
  show("Schema validation at the route (Joi / zod)", {
    code: `// This repo already ships Joi (see src/validators/).
const loginSchema = Joi.object({
  email:    Joi.string().email().required(),      // an OBJECT fails: not a string
  password: Joi.string().min(8).required(),
});

router.post("/login", validate(loginSchema), loginController);`,
    "why it works": "Joi rejects { $ne: null } because it is not a string — before any query runs",
    "bonus": "the client gets a clear 400 instead of a confusing 401 or a leaked user",
  });
  show("An allow-list for anything that selects behaviour", {
    bad: "Product.find().sort(req.query.sort)          // client controls the sort",
    good: `const SORTS = { "price-asc": { price: 1 }, newest: { createdAt: -1 } };
Product.find().sort(SORTS[req.query.sort] ?? { createdAt: -1 });`,
    "same idea applies to": "field projections, filter field names, collection names, index hints",
  });

  // --------------------------------------------------------------------
  section("8. Defence 4 — sanitize $ and . globally");
  show("express-mongo-sanitize (defence in depth)", {
    what: "strips or replaces keys starting with $ or containing . in req.body/query/params",
    install: "npm i express-mongo-sanitize",
    usage: 'app.use(mongoSanitize({ replaceWith: "_" }));',
    "why replaceWith": "silently deleting keys can mask an attack; replacing makes it visible in logs",
    caveat:
      "Express 5 makes req.query a getter, so use the middleware's per-request form or sanitize req.body only",
    "the important part": "this is a SAFETY NET, not the primary defence — validate and coerce first",
  });

  // --------------------------------------------------------------------
  section("9. Mass assignment — the other injection");
  // Not a filter attack: an attacker adds fields to a request body hoping
  // they get written.
  const attackerBody = { name: "Innocent", email: "x@example.com", role: "admin", loyaltyPoints: 999999 };

  // Mongoose's strict mode drops fields not in the schema, but `role` IS in
  // the schema — so this would happily make them an admin.
  const wouldBeCreated = new User(attackerBody);
  show("Blindly spreading a request body into a model", {
    bodySent: attackerBody,
    "role that would be saved": wouldBeCreated.role,
    "loyaltyPoints that would be saved": wouldBeCreated.loyaltyPoints,
  });
  show("The fix — pick fields explicitly", {
    bad: "await User.create({ ...req.body })",
    good: `await User.create({
  name:  String(req.body.name),
  email: String(req.body.email),
  role:  "customer",          // NEVER from the request
});`,
    "for updates": "build the $set object field by field, never $set: req.body",
    "also": "select: false on sensitive fields, and a toJSON transform so they never leave (module 13)",
  });
  note(
    "Mongoose's strict mode protects you from fields OUTSIDE the schema. It " +
      "does nothing about fields that are in the schema but should not be " +
      "client-controlled — role, isActive, loyaltyPoints, deletedAt. Those " +
      "need an explicit allow-list."
  );

  // --------------------------------------------------------------------
  section("10. A checklist you can apply to any endpoint");
  show("For every value that reaches a query", {
    "1. Is it validated?": "Joi/zod schema on the route — reject wrong shapes early",
    "2. Is it coerced?": "String(), Number(), or an allow-list lookup",
    "3. Could it be an object?": "if yes, an operator can be injected",
    "4. Does it choose behaviour?": "sort/projection/field names must come from an allow-list",
    "5. Is it a regex?": "never accept one from a client; escape and anchor your own",
    "6. Does it write?": "pick fields explicitly — never spread req.body",
    "7. Is $where involved?": "replace it with $expr, and disable server-side JS",
    "8. Is there a safety net?": "express-mongo-sanitize, plus a rate limit on auth endpoints",
  });
  note(
    "None of this requires the id we used above, but note the pattern for " +
      "ids too: " +
      `mongoose.Types.ObjectId.isValid(id) before querying, so ` +
      "/users/[object Object] is a 400 rather than a 500. Next: " +
      "02-safe-patterns covers secrets, connection hardening, replica sets, " +
      "and sharding."
  );
  show("Id validation, one more time", {
    valid: mongoose.Types.ObjectId.isValid("507f1f77bcf86cd799439011"),
    invalid: mongoose.Types.ObjectId.isValid("[object Object]"),
  });
});
