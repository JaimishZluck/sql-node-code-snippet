import joi from 'joi';

// Define your validators below
// Example:
// export const yourValidator = joi.object({
//   fieldName: joi.string().required().messages({
//     'string.empty': 'Field cannot be empty',
//     'any.required': 'Field is required'
//   }),
// });

export const queryValidator = joi.object({
  page: joi.number().min(1).default(1).messages({
    'number.base': 'Page must be a number',
    'number.min': 'Page must be greater than 0'
  }),
  limit: joi.number().min(1).max(100).default(10).messages({
    'number.base': 'Limit must be a number',
    'number.min': 'Limit must be greater than 0',
    'number.max': 'Limit cannot exceed 100'
  }),
  search: joi.string().allow('').optional()
});

export const statusQueryValidator = joi.object({
  includeUser: joi.boolean().default(false).messages({
    'boolean.base': 'includeUser must be a boolean'
  })
});

