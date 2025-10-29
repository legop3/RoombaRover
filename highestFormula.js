function highestLettersCount(message) {
  const tallyWords = message.toLowerCase().split(/\s+/);
  const letters = tallyWords.join('');
  const counts = new Map();
  for (const ch of letters) {
    counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const maxCount = Math.max(...counts.values());
  return maxCount / letters.length;
}

console.log(highestLettersCount('khfdlksajhflkashdliyuairhlofef94u398fy'));
console.log(highestLettersCount('hello world again'));
