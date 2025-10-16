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
        const userDiv = document.createElement('div');
        userDiv.className = 'p-1 bg-purple-500 rounded-xl mt-1 text-xs';

        const isSelf = socket.id && user.id === socket.id;
        const baseName = (user && typeof user.nickname === 'string' && user.nickname.trim())
            ? user.nickname.trim()
            : (user.id && user.id.length > 6 ? `User ${user.id.slice(-6)}` : user.id);
        const label = isSelf ? `You (${baseName})` : baseName || 'User';
        const authStatus = user.authenticated ? 'Yes' : 'No';

        userDiv.innerText = `${label} (${user.id}) - Auth: ${authStatus}`;
        dom.userList.appendChild(userDiv);
    });
});
