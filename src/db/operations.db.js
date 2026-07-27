import mongoose from "mongoose";

export async function fetchSingleData(model, whereCondition, includeData = []) {
  let query = model.findOne(whereCondition);

  if (Array.isArray(includeData) && includeData.length > 0) {
    includeData.forEach((path) => {
      query = query.populate(path);
    });
  }

  return await query.exec();
}

// create new document in database
export async function createdata(model, data, session = null) {
  return await model.create([data], { session }).then((docs) => docs[0]);
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

  if (options.sort) query = query.sort(options.sort);
  if (typeof options.skip === "number") query = query.skip(options.skip);
  if (typeof options.limit === "number") query = query.limit(options.limit);
  if (options.select) query = query.select(options.select);

  if (Array.isArray(options.populate) && options.populate.length > 0) {
    options.populate.forEach((path) => {
      query = query.populate(path);
    });
  }

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
