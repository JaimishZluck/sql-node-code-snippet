# Copilot Patterns

## Example Controller Pattern
```js
const ControllerAsyncFunction1 = async (req, res, next) => {
  try {
    const body = req.body;
    const data = await serviceAsyncFucntion1(body);
    return res.status(201).json(new ApiResponse(201, data, "Data created successfully"));
  } catch (error) {
    next(error); // Always pass errors to middleware
  }
};

// Controller handling resource not found
const ControllerGetUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await serviceGetUserById(id); // Service throws ApiError if not found
    return res.status(200).json(new ApiResponse(200, data, "User retrieved successfully"));
  } catch (error) {
    next(error);
  }
};
```

## Example Service Pattern
```js
const serviceAsyncFucntion1 = async (body) => {
  const transaction = await sequelize.transaction();
  try {
    validateUserData(body); // Utility throws ApiError if validation fails
    const result = await createdata(Name, body, transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error instanceof ApiError ? error : new ApiError(500, "Failed to create data", [error.message], error.stack);
  }
};

// Service that uses utility to check if data exists
const serviceGetUserById = async (id) => {
  try {
    const validId = validateId(id, "User ID"); // Utility validates and throws ApiError
    const user = await fetchSingleData(Name, { id: validId });
    ensureDataExists(user, "User"); // Utility throws ApiError if null
    return user;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Failed to retrieve user", [error.message], error.stack);
  }
};
```

## Example Utility Functions Throwing ApiError
```js
// Validation utility
export const validateUserData = (userData) => {
  if (!userData) {
    throw new ApiError(400, "User data is required", ["Missing user data in request body"]);
  }
  if (!userData.name || userData.name.trim() === '') {
    throw new ApiError(400, "Name is required", ["Name field cannot be empty"]);
  }
  return true;
};

// Resource existence utility
export const ensureDataExists = (data, entityName = "Resource") => {
  if (!data) {
    throw new ApiError(404, `${entityName} not found`, [`The requested ${entityName.toLowerCase()} does not exist`]);
  }
  return data;
};

// ID validation utility
export const validateId = (id, fieldName = "ID") => {
  if (!id) {
    throw new ApiError(400, `${fieldName} is required`, [`Missing ${fieldName.toLowerCase()} parameter`]);
  }
  const numId = parseInt(id);
  if (isNaN(numId) || numId < 1) {
    throw new ApiError(400, `Invalid ${fieldName}`, [`${fieldName} must be a positive number`]);
  }
  return numId;
};
```

## Example ApiResponse Formats
```js
// Success with data
new ApiResponse(200, { id: 1, name: "John" }, "User retrieved successfully")

// Success with empty array
new ApiResponse(200, [], "No matching records found")

// Created resource
new ApiResponse(201, { id: 5, name: "Jane" }, "User created successfully")

// Success with pagination
new ApiResponse(200, {
  data: users,
  pagination: { page: 1, limit: 10, total: 25 }
}, "Users retrieved successfully")
```

## Example ApiError Usage
```js
// Validation error
throw new ApiError(400, "Invalid input", ["Name is required", "Email format invalid"]);

// Resource not found
throw new ApiError(404, "User not found", ["No user with given ID"]);

// Server error with preserved stack
throw new ApiError(500, "Database operation failed", [error.message], error.stack);

// Business logic error
throw new ApiError(409, "Email already exists", ["This email is already registered"]);
```

## Example Error Middleware
```js
const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle ValidationError
  if (error instanceof ValidationError) {
    error = new ApiError(400, error.message, error.errors, error.stack);
  }

  // Handle Sequelize errors
  if (error instanceof Sequelize.BaseError) {
    // Convert to ApiError with appropriate status codes
    error = new ApiError(statusCode, message, errors, error.stack);
  }

  // Wrap non-ApiError instances
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || "Something went wrong";
    error = new ApiError(statusCode, message, error?.errors || [], error.stack);
  }

  // Log complete error details (ONLY place for error logging)
  logger.error(
    `${req.method} ${req.originalUrl} || ${req.ip} || ${error.statusCode} || ${error.message}\n${error.stack}`
  );

  // Return structured response to client
  return res.status(error.statusCode).json({
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    errors: error.errors,
    ...(process.env.NODE_ENV === "development" ? { stack: error.stack } : {}),
  });
};
```

## Handling Empty Data Patterns

### Empty Data as Success (Search Results)
```js
const ControllerSearchData = async (req, res, next) => {
  try {
    const data = await serviceSearchData(search);
    if (data.length === 0) {
      return res.status(200).json(new ApiResponse(200, [], "No matching records found"));
    }
    return res.status(200).json(new ApiResponse(200, data, "Search completed successfully"));
  } catch (error) {
    next(error);
  }
};
```

### Empty Data as Controlled Error (Required Resource)
```js
const serviceGetUserById = async (id) => {
  try {
    const user = await fetchSingleData(Name, { id });
    ensureDataExists(user, "User"); // Throws ApiError(404) if null
    return user;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError(500, "Failed to retrieve user", [error.message], error.stack);
  }
};
```

## Route Patterns
```js
router.route('/')
  .post(validate({ body: nameValidator }), ControllerCreate)
  .get(validate({ query: queryValidator }), ControllerGetAll);

router.route('/:id')
  .get(ControllerGetById) // Service handles validation and not found

router.route('/search')
  .get(validate({ query: queryValidator }), ControllerSearch);
```
