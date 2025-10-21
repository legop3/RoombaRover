import { socket } from './socketGlobal.js';
import { dom } from './dom.js';
import { setCookie, readCookie } from './uiState.js';

console.log('presence module loaded');

const USER_LIST_COOKIE = 'userListHidden';
function applyInitialVisibility() {
    const stored = readCookie(USER_LIST_COOKIE);
    if (!dom.userList || typeof stored === 'undefined') return;
    const shouldHide = stored === 'true';
    dom.userList.classList.toggle('hidden', shouldHide);
}

if (dom.userCounter && dom.userList) {
    applyInitialVisibility();
    dom.userCounter.addEventListener('click', () => {
        const nowHidden = dom.userList.classList.toggle('hidden');
        setCookie(USER_LIST_COOKIE, String(nowHidden));
    });
}

socket.on('usercount', count => {
    if (!dom.userCounter) return;
    const safeCount = Number.isFinite(count) ? count : 0;
    dom.userCounter.innerText = `${safeCount} Online`;
});

socket.on('userlist', users => {
    if (!dom.userList) return;
    dom.userList.innerHTML = '';
    if (!Array.isArray(users) || users.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'p-1 text-sm text-gray-300';
        empty.innerText = 'No users connected.';
        dom.userList.appendChild(empty);
        return;
    }

    users.forEach(user => {
        const userRow = document.createElement('div');
        userRow.className = 'mt-1 flex items-center justify-between gap-1 rounded-xl bg-gray-700 px-1 py-1 text-xs sm:text-sm';
        const isSelf = socket.id && user.id === socket.id;
        const baseName = (user && typeof user.nickname === 'string' && user.nickname.trim())
            ? user.nickname.trim()
            : (user.id && user.id.length > 6 ? `User ${user.id.slice(-6)}` : user.id);
        const label = baseName || 'User';
        const nameSpan = document.createElement('span');
        nameSpan.className = isSelf ? 'font-semibold text-white' : 'text-gray-200';
        nameSpan.textContent = isSelf ? `${label} (You)` : label;

        const badges = document.createElement('div');
        badges.className = 'flex items-center gap-1';

        const roleBadge = document.createElement('span');
        const isSpectator = Boolean(user?.isSpectator);
        roleBadge.className = `inline-flex items-center rounded-full px-1 py-0.5 text-xs font-semibold ${isSpectator ? 'bg-blue-500 text-white' : 'bg-green-600 text-white'}`;
        roleBadge.textContent = isSpectator ? 'Spectator' : 'Driver';
        badges.appendChild(roleBadge);

        const isAdmin = Boolean(user?.isAdmin);
        const adminBadge = document.createElement('span');
        adminBadge.className = `inline-flex items-center rounded-full px-1 py-0.5 text-xs font-semibold ${isAdmin ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-gray-200'}`;
        adminBadge.textContent = isAdmin ? 'Admin' : 'Not admin';
        badges.appendChild(adminBadge);

        userRow.appendChild(nameSpan);
        userRow.appendChild(badges);

        dom.userList.appendChild(userRow);
    });
});
