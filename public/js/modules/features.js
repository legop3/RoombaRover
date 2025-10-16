console.log('features module loaded');

const DEFAULT_FEATURES = {
    allowChatSend: true,
    allowLightControl: true,
    requireAdminLogin: true,
    requestSensorDataOnConnect: true,
    autoStartAvOnConnect: true,
    forceSpectateMode: false
};

const features = Object.assign(
    {},
    DEFAULT_FEATURES,
    typeof window !== 'undefined' && window.__ROVER_FEATURES__
        ? window.__ROVER_FEATURES__
        : {}
);

function featureEnabled(name, fallback = false) {
    if (Object.prototype.hasOwnProperty.call(features, name)) {
        return Boolean(features[name]);
    }
    return Boolean(fallback);
}

export { features, featureEnabled };
