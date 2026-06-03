const ApiError = require('./apiError');

const getClientPasswordError = (password) => {
  if (!password) return 'Password is required';
  if (/\s/.test(password)) return 'Password must not contain spaces';
  if (password.length !== 8) return 'Password must contain exactly 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must include at least 1 uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include at least 1 lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include at least 1 number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least 1 special character';
  return null;
};

const validateClientPassword = (password) => {
  const error = getClientPasswordError(password);
  if (error) throw ApiError.badRequest(error);
};

module.exports = { getClientPasswordError, validateClientPassword };
