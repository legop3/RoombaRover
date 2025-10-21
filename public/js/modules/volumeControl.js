import { dom } from './dom.js';

const STORAGE_KEY = 'roverVolume';
const DEFAULT_VOLUME = 1;

const subscribers = new Set();

function clampVolume(value) {
    if (!Number.isFinite(value)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, value));
}

function readStoredVolume() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return DEFAULT_VOLUME;
        const parsed = parseFloat(raw);
        if (Number.isNaN(parsed)) return DEFAULT_VOLUME;
        return clampVolume(parsed);
    } catch {
        return DEFAULT_VOLUME;
    }
}

let currentVolume = clampVolume(readStoredVolume());

function updateDisplay() {
    if (dom.volumeSlider) {
        dom.volumeSlider.value = String(Math.round(currentVolume * 100));
    }
    if (dom.volumeDisplay) {
        dom.volumeDisplay.textContent = `${Math.round(currentVolume * 100)}%`;
    }
}

function notifySubscribers() {
    subscribers.forEach(listener => {
        try {
            listener(currentVolume);
        } catch (error) {
            console.warn('Volume listener failed', error);
        }
    });

    try {
        window.dispatchEvent(new CustomEvent('rover-volume-change', {
            detail: { volume: currentVolume }
        }));
    } catch {
        // ignore
    }
}

export function getVolume() {
    return currentVolume;
}

export function setVolume(volume) {
    const clamped = clampVolume(volume);
    currentVolume = clamped;
    updateDisplay();
    try {
        localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
        // ignore storage errors
    }
    notifySubscribers();
}

export function subscribeVolume(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    try {
        listener(currentVolume);
    } catch (error) {
        console.warn('Initial volume listener failed', error);
    }
    return () => {
        subscribers.delete(listener);
    };
}

export function bindMediaElement(mediaElement) {
    if (!mediaElement) return () => {};
    const listener = volume => {
        try {
            mediaElement.volume = volume;
        } catch {
            // ignore assignment issues
        }
    };
    listener(currentVolume);
    return subscribeVolume(listener);
}

function handleSliderInput(event) {
    const value = Number(event.target.value);
    if (Number.isNaN(value)) return;
    setVolume(value / 100);
}

if (dom.volumeSlider) {
    dom.volumeSlider.addEventListener('input', handleSliderInput);
    dom.volumeSlider.addEventListener('change', handleSliderInput);
}

updateDisplay();
notifySubscribers();
