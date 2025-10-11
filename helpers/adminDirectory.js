const config = require('./config');

function normalizeString(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function buildAdminEntries() {
    const configuredAdmins = Array.isArray(config.accessControl?.admins)
        ? config.accessControl.admins
        : [];

    if (configuredAdmins.length > 0) {
        return configuredAdmins
            .filter((admin) => normalizeString(admin?.password))
            .map((admin, index) => ({
                name: normalizeString(admin?.name) || `Admin ${index + 1}`,
                password: normalizeString(admin.password),
                discordId: normalizeString(admin?.discordId) || null,
                lockdown: admin?.lockdown || false
            }));
    }

    const fallbackPassword = normalizeString(config.accessControl?.adminPassword);
    if (!fallbackPassword) return [];

    const fallbackDiscordIds = Array.isArray(config.discordBot?.administratorIDs)
        ? config.discordBot.administratorIDs
        : [];

    if (fallbackDiscordIds.length > 0) {
        return fallbackDiscordIds.map((discordId, index) => ({
            name: `Discord Admin ${index + 1}`,
            password: fallbackPassword,
            discordId: normalizeString(discordId) || null,
        }));
    }

    return [{
        name: 'Admin',
        password: fallbackPassword,
        discordId: null,
        lockdown: false
    }];
}

const cachedAdmins = buildAdminEntries();

function getAdmins() {
    return cachedAdmins.slice();
}

function findAdminByPassword(password) {
    const token = normalizeString(password);
    if (!token) return null;
    return cachedAdmins.find((admin) => admin.password === token) || null;
}

function getDiscordAdminIds() {
    const ids = [];
    for (const admin of cachedAdmins) {
        if (admin.discordId && !ids.includes(admin.discordId)) {
            ids.push(admin.discordId);
        }
    }
    return ids;
}

module.exports = {
    getAdmins,
    findAdminByPassword,
    getDiscordAdminIds,
};
