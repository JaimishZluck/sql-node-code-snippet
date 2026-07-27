# mongodb-node-code-snippet

## DB layer (Mongoose)

The DB helpers are in [operations.db.js](J:/Jaimish/Projects/architecture/src/db/operations.db.js) and connection bootstrap is in [loader.db.js](J:/Jaimish/Projects/architecture/src/db/loader.db.js).

## Query examples

### 1) Populate single relation

```js
const order = await fetchSingleData(Order, { _id: orderId }, { populate: "user_id" });
```

### 2) Populate with select on relation

```js
const order = await fetchSingleData(Order, { _id: orderId }, {
  populate: { path: "user_id", select: "name email" },
});
```

### 3) Multiple populate

```js
const rows = await findAllData(Order, {}, {
  populate: [
    { path: "user_id", select: "name email" },
    "created_by",
  ],
});
```

### 4) Filters + sorting + pagination + projection

```js
const rows = await findAllData(User, { email: /@gmail\.com$/i }, {
  select: "name email created_at",
  sort: { created_at: -1 },
  skip: 0,
  limit: 20,
});
```

### 5) Lean query + collation

```js
const rows = await findAllData(User, {}, {
  sort: { name: 1 },
  collation: { locale: "en", strength: 2 },
  lean: true,
});
```
