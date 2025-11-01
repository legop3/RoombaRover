const STORAGE_PREFIX = 'rr:pref:';
const DEFAULT_COOKIE_MAX_AGE_DAYS = 180;

function hasLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    const testKey = `${STORAGE_PREFIX}__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function serialize(value) {
  return JSON.stringify({ v: value });
}

function deserialize(raw) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'v')) {
      return parsed.v;
    }
  } catch {
    // Ignore malformed data and fall through to undefined.
  }
  return undefined;
}

function setCookie(name, value, options = {}) {
  if (typeof document === 'undefined') return;
  const { maxAgeDays = DEFAULT_COOKIE_MAX_AGE_DAYS, path = '/' } = options;
  const maxAgeSeconds = Math.max(0, Math.floor(maxAgeDays * 24 * 60 * 60));
  const encoded = encodeURIComponent(value);
  const parts = [`${name}=${encoded}`, `path=${path}`, 'SameSite=Lax'];
  if (maxAgeSeconds > 0) {
    parts.push(`Max-Age=${maxAgeSeconds}`);
  }
  document.cookie = parts.join('; ');
}

function getCookie(name) {
  if (typeof document === 'undefined') return undefined;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) {
      const value = cookie.slice(name.length + 1);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

function deleteCookie(name, options = {}) {
  if (typeof document === 'undefined') return;
  const { path = '/' } = options;
  document.cookie = `${name}=; path=${path}; Max-Age=0; SameSite=Lax`;
}

function storageKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function savePreference(key, value, options = {}) {
  const { storage = 'auto', cookie = {} } = options;
  const serialized = serialize(value);
  const shouldUseLocalStorage = storage === 'auto' || storage === 'localStorage';
  if (shouldUseLocalStorage && hasLocalStorage()) {
    window.localStorage.setItem(storageKey(key), serialized);
    if (storage === 'localStorage') {
      return;
    }
  }
  setCookie(storageKey(key), serialized, cookie);
}

function loadPreference(key, defaultValue = undefined, options = {}) {
  const { storage = 'auto' } = options;
  const shouldUseLocalStorage = storage === 'auto' || storage === 'localStorage';
  if (shouldUseLocalStorage && hasLocalStorage()) {
    const raw = window.localStorage.getItem(storageKey(key));
    const value = deserialize(raw);
    if (value !== undefined) {
      return value;
    }
    if (storage === 'localStorage') {
      return defaultValue;
    }
  }
  const rawCookie = getCookie(storageKey(key));
  const value = deserialize(rawCookie);
  return value !== undefined ? value : defaultValue;
}

function clearPreference(key, options = {}) {
  if (hasLocalStorage()) {
    window.localStorage.removeItem(storageKey(key));
  }
  deleteCookie(storageKey(key), options.cookie);
}

export {
  savePreference,
  loadPreference,
  clearPreference,
  hasLocalStorage,
  setCookie,
  getCookie,
  deleteCookie
};
