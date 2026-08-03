/**
 * Custom API Error Class
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    if (typeof message === 'number') {
      const temp = message;
      message = statusCode;
      statusCode = temp;
    }
    super(typeof message === 'string' ? message : 'An error occurred');
    this.statusCode = typeof statusCode === 'number' ? statusCode : 500;
    this.errors = errors;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', errors = null) {
    return new ApiError(message, 400, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(message, 401);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(message, 403);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(message, 404);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(message, 409);
  }

  static validationError(message = 'Validation failed', errors = null) {
    return new ApiError(message, 422, errors);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(message, 500);
  }
}

module.exports = ApiError;
