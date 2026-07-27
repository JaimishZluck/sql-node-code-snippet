import mongoose from "mongoose";

function applyPopulate(query, populate) {
  if (!populate) return query;

  if (Array.isArray(populate)) {
    populate.forEach((value) => {
      query = query.populate(value);
    });
    return query;
  }

  return query.populate(populate);
}

function applyQueryOptions(query, options = {}) {
  if (options.select) query = query.select(options.select);
  if (options.sort) query = query.sort(options.sort);
  if (typeof options.skip === "number") query = query.skip(options.skip);
  if (typeof options.limit === "number") query = query.limit(options.limit);
  if (options.collation) query = query.collation(options.collation);
  query = applyPopulate(query, options.populate);
  if (options.lean === true) query = query.lean();

  return query;
}

export async function fetchSingleData(model, whereCondition, options = {}) {
  const normalizedOptions = Array.isArray(options)
    ? { populate: options }
    : options;
  let query = model.findOne(whereCondition);
  query = applyQueryOptions(query, normalizedOptions);

  return await query.exec();
}

// create new document in database
export async function createdata(model, data, session = null) {
  const docs = await model.create([data], { session });
  return docs[0];
}

// bulk create in database
export async function bulkCreatedata(model, data, session = null) {
  return await model.insertMany(data, { session });
}

// update document in database and return updated document
export async function updateData(model, whereCondition, data, options = {}) {
  return await model.findOneAndUpdate(whereCondition, data, {
    new: true,
    runValidators: true,
    ...options,
  });
}

// find all data
export async function findAllData(model, filter = {}, options = {}) {
  let query = model.find(filter);
  query = applyQueryOptions(query, options);

  return await query.exec();
}

// delete one document from database
export async function deleteData(model, whereCondition, options = {}) {
  return await model.findOneAndDelete(whereCondition, options);
}

// start transaction session
export async function startTransaction() {
  const session = await mongoose.startSession();
  session.startTransaction();
  return session;
}
