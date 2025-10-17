const TAB_STORAGE_KEY = 'newdrive:active-tab';

function initTabs() {
    const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
    const tabPanels = new Map(
        Array.from(document.querySelectorAll('[data-tab-panel]')).map(panel => [panel.dataset.tabPanel, panel])
    );

    if (!tabButtons.length || !tabPanels.size) {
        return;
    }

    const activateTab = (name) => {
        const fallback = tabButtons[0].dataset.tab;
        const target = tabPanels.has(name) ? name : fallback;

        tabButtons.forEach(button => {
            const isActive = button.dataset.tab === target;
            button.setAttribute('aria-selected', String(isActive));
            button.classList.toggle('bg-blue-500', isActive);
            button.classList.toggle('bg-gray-700', !isActive);
        });

        tabPanels.forEach((panel, key) => {
            panel.classList.toggle('hidden', key !== target);
        });

        try {
            localStorage.setItem(TAB_STORAGE_KEY, target);
        } catch (error) {
            console.debug('Unable to persist tab selection', error);
        }
    };

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            activateTab(button.dataset.tab);
        });
    });

    let initialTab = tabButtons[0].dataset.tab;
    try {
        const stored = localStorage.getItem(TAB_STORAGE_KEY);
        if (stored && tabPanels.has(stored)) {
            initialTab = stored;
        }
    } catch (error) {
        console.debug('Unable to read stored tab', error);
    }

    activateTab(initialTab);
}

export { initTabs };
