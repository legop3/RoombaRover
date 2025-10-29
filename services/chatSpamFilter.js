const { createLogger } = require('../helpers/logger');

const DEFAULT_OPTIONS = {
    // Allow up to 4 messages in an 8 second window.
    rateLimit: {
        limit: 4,
        intervalMs: 8000,
    },
    // Maximum duplicate messages (case-insensitive) in the duplicateWindowMs.
    duplicateLimit: 2,
    duplicateWindowMs: 30_000,
    // Minimum length for entropy-based checks.
    entropyMinLength: 12,
    keymash: {
        minLength: 16,
        minUniqueRatio: 0.5,
        maxVowelRatio: 0.4,
        minConsonantRun: 6,
        maxCharRepeatRatio: 0.3,
        digitRatioRange: [0.1, 0.6],
        minScore: 3,
    },
};

class ChatSpamFilter {
    constructor(options = {}) {
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
            rateLimit: {
                ...DEFAULT_OPTIONS.rateLimit,
                ...(options.rateLimit || {}),
            },
            keymash: {
                ...DEFAULT_OPTIONS.keymash,
                ...(options.keymash || {}),
            },
        };
        this.logger = createLogger('ChatSpamFilter');
        this.userState = new Map();
    }

    reset(userId) {
        if (!userId) return;
        this.userState.delete(userId);
    }

    evaluate(userId, message, timestamp = Date.now()) {
        if (!userId || typeof message !== 'string') {
            return { allowed: false, reason: 'Invalid chat payload.' };
        }

        const normalized = this.normalizeMessage(message);
        if (!normalized) {
            return { allowed: false, reason: 'Empty message.' };
        }

        const state = this.getUserState(userId);
        if (!this.passRateLimit(state, timestamp)) {
            return { allowed: false, reason: 'Too many messages, slow down.' };
        }

        if (!this.passDuplicateCheck(state, normalized, timestamp)) {
            return { allowed: false, reason: 'Please avoid repeating the same message.' };
        }

        if (this.hasRepeatingCharacters(message)) {
            return { allowed: false, reason: 'Message contains too many repeating characters.' };
        }

        if (this.hasLowEntropy(message)) {
            return { allowed: false, reason: 'Message looks too repetitive.' };
        }

        if (this.hasRepeatedWords(message)) {
            return { allowed: false, reason: 'Message repeats the same words too often.' };
        }

        if (this.hasKeymashWord(message)) {
            return { allowed: false, reason: 'Message looks like keymashing.' };
        }

        // Only commit state when all checks pass.
        this.commitMessage(state, timestamp, normalized);
        return { allowed: true };
    }

    normalizeMessage(message) {
        return message
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    getUserState(userId) {
        if (!this.userState.has(userId)) {
            this.userState.set(userId, {
                timestamps: [],
                recentMessages: [],
            });
        }
        return this.userState.get(userId);
    }

    commitMessage(state, timestamp, normalizedMessage) {
        const { rateLimit } = this.options;
        state.timestamps.push(timestamp);
        state.recentMessages.push({ text: normalizedMessage, timestamp });
        // Keep structures bounded.
        if (state.timestamps.length > rateLimit.limit * 3) {
            state.timestamps.splice(0, state.timestamps.length - rateLimit.limit * 3);
        }
        if (state.recentMessages.length > 6) {
            state.recentMessages.splice(0, state.recentMessages.length - 6);
        }
    }

    passRateLimit(state, timestamp) {
        const { limit, intervalMs } = this.options.rateLimit;
        const threshold = timestamp - intervalMs;
        state.timestamps = state.timestamps.filter((value) => value >= threshold);
        if (state.timestamps.length >= limit) {
            this.logger.debug('Rate limit triggered', { count: state.timestamps.length, limit });
            return false;
        }
        return true;
    }

    passDuplicateCheck(state, normalizedMessage, timestamp) {
        const { duplicateWindowMs, duplicateLimit } = this.options;
        const threshold = timestamp - duplicateWindowMs;
        state.recentMessages = state.recentMessages.filter((entry) => entry.timestamp >= threshold);
        const duplicateCount = state.recentMessages.filter((entry) => entry.text === normalizedMessage).length;
        if (duplicateCount >= duplicateLimit) {
            this.logger.debug('Duplicate message limit triggered', { duplicateCount, duplicateLimit, normalizedMessage });
            return false;
        }
        return true;
    }

    hasRepeatingCharacters(message) {
        // Detect extended runs of the same character or pattern.
        if (/(.)\1{6,}/i.test(message)) {
            return true;
        }
        if (/(..+)\1{3,}/i.test(message)) {
            return true;
        }
        return false;
    }

    hasLowEntropy(message) {
        const sanitized = message.replace(/\s+/g, '').toLowerCase();
        if (sanitized.length < this.options.entropyMinLength) {
            return false;
        }
        const distinct = new Set(sanitized);
        // If the message is mostly made up of 3 or fewer unique characters it is likely spam.
        return distinct.size <= 3;
    }

    hasRepeatedWords(message) {
        const words = message
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        if (words.length < 6) {
            return false;
        }
        const counts = new Map();
        for (const word of words) {
            counts.set(word, (counts.get(word) || 0) + 1);
        }
        const totalWords = words.length;
        const maxCount = Math.max(...counts.values());
        // Trigger if a single word comprises at least 70% of the message.
        if (maxCount / totalWords >= 0.7) {
            return true;
        }
        if (counts.size <= 2 && totalWords >= 8) {
            return true;
        }
        return false;
    }

    hasKeymashWord(message) {
        const { keymash } = this.options;
        if (!keymash) return false;
        const {
            minLength,
            minUniqueRatio,
            maxVowelRatio,
            minConsonantRun,
            maxCharRepeatRatio,
            digitRatioRange,
            minScore,
        } = keymash;
        const tokens = message.split(/\s+/);
        for (const token of tokens) {
            const normalized = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
            if (normalized.length < minLength) continue;
            if (!/[a-z]/.test(normalized)) continue;

            const uniqueRatio = this.calculateUniqueRatio(normalized);
            const vowelRatio = this.calculateVowelRatio(normalized);
            const consonantRun = this.longestConsonantRun(normalized);
            const charRepeatRatio = this.highestCharFrequencyRatio(normalized);
            const digitRatio = this.calculateDigitRatio(normalized);

            let score = 0;
            if (uniqueRatio >= minUniqueRatio) score += 1;
            if (vowelRatio <= maxVowelRatio) score += 1;
            if (consonantRun >= minConsonantRun) score += 1;
            if (charRepeatRatio <= maxCharRepeatRatio) score += 1;

            if (Array.isArray(digitRatioRange) && digitRatioRange.length === 2) {
                const [minDigit, maxDigit] = digitRatioRange;
                if (digitRatio >= minDigit && digitRatio <= maxDigit) {
                    score += 1;
                }
            }

            if (score >= minScore) {
                return true;
            }
        }
        return false;
    }

    calculateUniqueRatio(text) {
        if (!text) return 0;
        const uniqueChars = new Set(text);
        return uniqueChars.size / text.length;
    }

    calculateVowelRatio(text) {
        if (!text) return 0;
        const vowels = text.match(/[aeiou]/g);
        const count = vowels ? vowels.length : 0;
        return count / text.length;
    }

    longestConsonantRun(text) {
        let longest = 0;
        let current = 0;
        for (const char of text) {
            if (/[aeiou0-9]/.test(char)) {
                current = 0;
            } else {
                current += 1;
                if (current > longest) {
                    longest = current;
                }
            }
        }
        return longest;
    }

    highestCharFrequencyRatio(text) {
        if (!text) return 0;
        const counts = new Map();
        for (const char of text) {
            counts.set(char, (counts.get(char) || 0) + 1);
        }
        const maxCount = Math.max(...counts.values());
        return maxCount / text.length;
    }

    calculateDigitRatio(text) {
        if (!text) return 0;
        const digits = text.match(/\d/g);
        const count = digits ? digits.length : 0;
        return count / text.length;
    }
}

module.exports = ChatSpamFilter;
