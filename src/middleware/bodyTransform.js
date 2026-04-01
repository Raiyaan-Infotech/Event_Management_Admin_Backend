/**
 * Convert camelCase to snake_case for request body
 */
const camelToSnake = (str) => {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

const transformObjectKeys = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformObjectKeys);
  }

  if (typeof obj === 'object' && !(obj instanceof Date) && !(obj instanceof RegExp)) {
    const transformed = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const snakeKey = camelToSnake(key);
        transformed[snakeKey] = transformObjectKeys(obj[key]);
      }
    }
    return transformed;
  }

  return obj;
};

const bodyTransform = (req, res, next) => {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    req.body = transformObjectKeys(req.body);
  }
  next();
};

module.exports = bodyTransform;
