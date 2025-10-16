console.log("UI Config JS loaded");

import { dom } from './dom.js';

function applyUiConfig(data = {}) {
    const inviteButton = dom.discordInviteButton;
    const inviteButtonOverlay = dom.discordInviteButtonOverlay;

    const inviteURL = typeof data.discordInviteURL === 'string' ? data.discordInviteURL.trim() : '';

    const enableButton = (button) => {
        if (!button) return;
        button.href = inviteURL || '#';
        if (inviteURL) {
            button.classList.remove('hidden');
            button.removeAttribute('aria-disabled');
        } else {
            button.classList.add('hidden');
            button.setAttribute('aria-disabled', 'true');
        }
    };

    enableButton(inviteButton);
    enableButton(inviteButtonOverlay);
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
