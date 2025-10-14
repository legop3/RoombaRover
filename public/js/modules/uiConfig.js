console.log("UI Config JS loaded");

import { dom } from './dom.js';

function applyUiConfig(data = {}) {
    const inviteButton = dom.discordInviteButton;
    const inviteButtonOverlay = dom.discordInviteButtonOverlay;
    if (!inviteButton) return;

    const inviteURL = typeof data.discordInviteURL === 'string' ? data.discordInviteURL.trim() : '';

    if (inviteURL) {
        inviteButton.href = inviteURL;
        inviteButton.classList.remove('hidden');
        inviteButton.removeAttribute('aria-disabled');

        inviteButtonOverlay.href = inviteURL;
    } else {
        inviteButton.href = '#';
        inviteButton.classList.add('hidden');
        inviteButton.setAttribute('aria-disabled', 'true');
    }
}

async function fetchDiscordInvite() {
    try {
        const response = await fetch('/discord-invite', { cache: 'no-store' });
        if (!response.ok) {
            console.warn('Failed to fetch Discord invite', response.status, response.statusText);
            return;
        }

        const inviteURL = (await response.text()).trim();
        applyUiConfig({ discordInviteURL: inviteURL });
    } catch (error) {
        console.warn('Failed to fetch Discord invite', error);
    }
}

fetchDiscordInvite();