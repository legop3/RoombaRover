const LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const LEVEL_NAMES = Object.keys(LEVELS);

let currentLevel = resolveLevel(process.env.LOG_LEVEL) ?? LEVELS.info;

function resolveLevel(levelName) {
    if (!levelName) return null;
    const normalized = String(levelName).trim().toLowerCase();
    if (normalized in LEVELS) {
        return LEVELS[normalized];
    }
    return null;
}

function formatPrefix(levelName, scope) {
    const paddedLevel = levelName.toUpperCase().padEnd(5);
    return scope
        ? `[${paddedLevel}] [${scope}]`
        : `[${paddedLevel}]`;
}

function emit(levelName, scope, args) {
    const numericLevel = LEVELS[levelName];
    if (numericLevel > currentLevel) {
        return;
    }

    const prefix = formatPrefix(levelName, scope);
    const outputArgs = Array.from(args);

    if (outputArgs.length === 0) {
        outputArgs.push(prefix);
    } else if (typeof outputArgs[0] === 'string') {
        outputArgs[0] = `${prefix} ${outputArgs[0]}`;
    } else {
        outputArgs.unshift(prefix);
    }

    const writer = levelName === 'error'
        ? console.error
        : levelName === 'warn'
            ? console.warn
            : console.log;

    writer.apply(console, outputArgs);
}

function createLogger(scope) {
    const label = scope || 'app';

    return {
        debug: (...args) => emit('debug', label, args),
        info: (...args) => emit('info', label, args),
        warn: (...args) => emit('warn', label, args),
        error: (...args) => emit('error', label, args),
        child: (childScope) => createLogger(childScope ? `${label}:${childScope}` : label),
    };
}

function setLogLevel(levelName) {
    const resolved = resolveLevel(levelName);
    if (resolved === null) {
        throw new Error(`Unknown log level: ${levelName}. Supported levels: ${LEVEL_NAMES.join(', ')}`);
    }
    currentLevel = resolved;
}

function getLogLevel() {
    return LEVEL_NAMES.find((name) => LEVELS[name] === currentLevel);
}

module.exports = {
    createLogger,
    setLogLevel,
    getLogLevel,
    levels: { ...LEVELS },
};
