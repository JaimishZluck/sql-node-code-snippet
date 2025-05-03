import joi from 'joi';

export const nameValidator = joi.object({
  name: joi.string().required().messages({
    'string.empty': 'Name cannot be empty',
    'any.required': 'Name is required'
  }),
  age: joi.number().required().messages({
    'number.base': 'Age must be a number',
    'any.required': 'Age is required'
  }),
  email: joi.string().email().required().messages({
    'string.email': 'Please enter a valid email',
    'string.empty': 'Email cannot be empty',
    'any.required': 'Email is required'
  }),
  password: joi.string().min(6).required().messages({
    'string.min': 'Password must be at least 6 characters',
    'string.empty': 'Password cannot be empty',
    'any.required': 'Password is required'
  }),
  confirmPassword: joi.string().valid(joi.ref('password')).required().messages({
    'any.only': 'Passwords must match',
    'string.empty': 'Confirm password cannot be empty',
    'any.required': 'Confirm password is required'
  })
});



