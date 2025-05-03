import { ApiError } from './apierror.util.js';

class ValidationError extends ApiError {
    constructor(message, errors = []) {
        super(400, message, errors);
    }
}

export { ValidationError };