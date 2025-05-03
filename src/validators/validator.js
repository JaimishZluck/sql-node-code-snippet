import { ValidationError } from '../utils/validationError.util.js';

export const validateData = async (joiObject, data) => {
    const { error } = joiObject.validate(data, { abortEarly: false });
    if (error) {
        console.error('Validation Error:', error.details.map(err => err.message));
        throw new ValidationError(error.details[ 0 ].message, error.details.map(err => err.message));
    }
    return true;
};
