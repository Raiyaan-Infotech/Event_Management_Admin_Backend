const safeParseJson = (value, fallback = null) => {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const safeParseArray = (value) => {
  const parsed = safeParseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
};

module.exports = {
  safeParseJson,
  safeParseArray,
};
