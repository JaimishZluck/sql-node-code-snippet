import logger from "../logger/winston.logger.js";
import { ApiResponse } from "../utils/apiResponse.util.js";
import { createOrder, getOrders, getOrdersAggregate, updateOrder, deleteOrder, upsertOrder } from "../services/order.service.js";

const create = async (req, res, next) => {
  try {
    const payload = req.body;
    const created = await createOrder(payload);
    return res.status(201).json(new ApiResponse(201, created, "Order created"));
  } catch (error) {
    return next(error);
  }
};

const list = async (req, res, next) => {
  try {
    const filter = { ...req.query };
    // remove pagination keys from filter
    delete filter.page;
    delete filter.limit;
    delete filter.sort;

    const options = {
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort ? JSON.parse(req.query.sort) : undefined,
      populate: req.query.populate ? req.query.populate.split(",") : undefined,
    };

    const data = await getOrders(filter, options);
    return res.status(200).json(new ApiResponse(200, data, "Orders fetched"));
  } catch (error) {
    return next(error);
  }
};

const listAgg = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.user) filter.user = req.query.user;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.from) filter.from = req.query.from;
    if (req.query.to) filter.to = req.query.to;

    const options = {
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort ? JSON.parse(req.query.sort) : undefined,
      include: req.query.include ? req.query.include.split(",") : [],
    };

    const result = await getOrdersAggregate(filter, options);
    return res.status(200).json(new ApiResponse(200, result, "Orders aggregation result"));
  } catch (error) {
    return next(error);
  }
};

const modify = async (req, res, next) => {
  try {
    const id = req.params.id;
    const payload = req.body;
    const updated = await updateOrder(id, payload);
    return res.status(200).json(new ApiResponse(200, updated, "Order updated"));
  } catch (error) {
    return next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const id = req.params.id;
    const removed = await deleteOrder(id);
    return res.status(200).json(new ApiResponse(200, removed, "Order deleted"));
  } catch (error) {
    return next(error);
  }
};

const upsert = async (req, res, next) => {
  try {
    const query = req.body.query;
    const data = req.body.data;
    const result = await upsertOrder(query, data);
    return res.status(200).json(new ApiResponse(200, result, "Order upserted"));
  } catch (error) {
    return next(error);
  }
};

export { create, list, listAgg, modify, remove, upsert };
