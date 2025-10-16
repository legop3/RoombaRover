console.log("Socket Global JS loaded");

const DEFAULT_SOCKET_CONFIG = {
    namespace: undefined,
    transports: ['websocket'],
    useClientKey: true,
    autoConnect: true,
    reconnection: true
};

const CLIENT_KEY_STORAGE_KEY = 'roombarover:client-key';

function readSocketConfig() {
    const raw = typeof window !== 'undefined' ? window.__ROVER_SOCKET_CONFIG__ : null;
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_SOCKET_CONFIG };
    }
    return {
        ...DEFAULT_SOCKET_CONFIG,
        ...raw
    };
}

function generateClientKey() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateClientKey() {
    try {
        let key = localStorage.getItem(CLIENT_KEY_STORAGE_KEY);
        if (typeof key === 'string' && key.trim()) {
            return key.trim();
        }
        key = generateClientKey();
        localStorage.setItem(CLIENT_KEY_STORAGE_KEY, key);
        return key;
    } catch (error) {
        console.warn('client key storage unavailable', error);
        return generateClientKey();
    }
}

const socketConfig = readSocketConfig();
const clientKey = socketConfig.useClientKey !== false ? getOrCreateClientKey() : null;

function buildAuthPayload() {
    const auth = socketConfig.auth && typeof socketConfig.auth === 'object'
        ? { ...socketConfig.auth }
        : {};

    if (clientKey) {
        auth.clientKey = clientKey;
    }

    return Object.keys(auth).length ? auth : undefined;
}

function buildSocketOptions() {
    const options = {
        transports: Array.isArray(socketConfig.transports) && socketConfig.transports.length
            ? socketConfig.transports
            : DEFAULT_SOCKET_CONFIG.transports,
        autoConnect: socketConfig.autoConnect,
        reconnection: socketConfig.reconnection
    };

    const auth = buildAuthPayload();
    if (auth) {
        options.auth = auth;
    }

    if (typeof socketConfig.path === 'string' && socketConfig.path.trim()) {
        options.path = socketConfig.path.trim();
    }

    return options;
}

const socketOptions = buildSocketOptions();
const namespace = typeof socketConfig.namespace === 'string' && socketConfig.namespace.length
    ? socketConfig.namespace
    : undefined;

const socket = namespace ? io(namespace, socketOptions) : io(socketOptions);

export { socket, clientKey, socketConfig };
