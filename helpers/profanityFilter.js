const Filter = require('bad-words');

const filter = new Filter();

filter.removeWords("fuck", "faggot", "ass", "shit");

function cleanProfanity(text) {
  if (typeof text !== 'string') return '';
  const normalized = text.trim();
  if (!normalized) return '';
  try {
    return filter.clean(normalized);
  } catch (error) {
    return normalized;
  }
}

function containsProfanity(text) {
  if (typeof text !== 'string') return false;
  try {
    return filter.isProfane(text);
  } catch (error) {
    return false;
  }
}

module.exports = {
  cleanProfanity,
  containsProfanity,
};
