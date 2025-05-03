export async function fetchSingleData(model, whereCondition, includeData = []) {
  return await model.findOne({
    where: whereCondition,
    include: includeData,
  });
}

// create new rowData in database
export async function createdata(model, data, transaction = null) {
  return await model.create(data, { transaction });
}

//Bulk Create in database
export async function bulkCreatedata(model, data, transaction = null) {
  return await model.bulkCreate(data, { transaction });
}

//Update RowData in database
export async function updateData(model, data) {
  return await model.update(data);
}

// find all data
export async function findAllData(model, data) {
  return await model.findAll(data);
}
