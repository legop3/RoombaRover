const STORAGE_PREFIX = 'newdrive:panel-state:';
const escapeSelector =
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape
    : (value) => value;

function updatePanelSpacing(panel, { isActive, isOnlyActive }) {
  const previousClass = panel.dataset.panelNavAppliedClass;
  if (previousClass) {
    panel.classList.remove(previousClass);
    delete panel.dataset.panelNavAppliedClass;
  }

  if (!isActive) {
    return;
  }

  const behavior = panel.dataset.panelNav;
  if (behavior === 'avoid' && isOnlyActive) {
    const paddingClass = panel.dataset.panelNavPadding || 'pt-11';
    if (paddingClass) {
      panel.classList.add(paddingClass);
      panel.dataset.panelNavAppliedClass = paddingClass;
    }
    return;
  }

  if (behavior === 'avoid') {
    const fallbackClass = panel.dataset.panelNavFallback || 'mt-1';
    if (fallbackClass) {
      panel.classList.add(fallbackClass);
      panel.dataset.panelNavAppliedClass = fallbackClass;
    }
  }
}

function readStoredState(key) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return new Set(parsed.filter((value) => typeof value === 'string'));
  } catch (error) {
    console.warn('[panelToggles] Failed to read stored state:', error);
    return null;
  }
}

function writeStoredState(key, state) {
  try {
    const serialized = JSON.stringify(Array.from(state));
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, serialized);
  } catch (error) {
    console.warn('[panelToggles] Failed to persist state:', error);
  }
}

function applyState({ state, toggles, panels }) {
  const visibleActiveIds = Array.from(state).filter((id) => panels.has(id));
  const activeCount = visibleActiveIds.length;

  toggles.forEach((toggle) => {
    const targetId = toggle.dataset.panelToggle;
    if (!targetId) {
      return;
    }

    const isActive = state.has(targetId);
    toggle.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    toggle.classList.toggle('bg-gray-300', isActive);
    toggle.classList.toggle('text-gray-900', isActive);
    toggle.classList.toggle('bg-gray-800', !isActive);
    toggle.classList.toggle('text-gray-200', !isActive);

    const panel = panels.get(targetId);
    if (!panel) {
      return;
    }

    panel.classList.toggle('hidden', !isActive);
    panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    updatePanelSpacing(panel, {
      isActive,
      isOnlyActive: isActive && activeCount === 1,
    });
  });
}

function initializeContainer(container) {
  const storageKey =
    container.getAttribute('data-panel-storage-key') || 'default';

  const toggles = Array.from(
    container.querySelectorAll('[data-panel-toggle]')
  );

  if (!toggles.length) {
    return;
  }

  const panels = new Map();
  toggles.forEach((toggle) => {
    const targetId = toggle.dataset.panelToggle;
    if (!targetId || panels.has(targetId)) {
      return;
    }

    const panel =
      container.querySelector(`#${escapeSelector(targetId)}`) ||
      document.getElementById(targetId);
    if (panel) {
      panels.set(targetId, panel);
    }
  });

  const defaultOpen = toggles
    .filter((toggle) => toggle.hasAttribute('data-panel-default'))
    .map((toggle) => toggle.dataset.panelToggle)
    .filter(Boolean);

  let activePanels = readStoredState(storageKey);
  if (activePanels) {
    activePanels = new Set(
      Array.from(activePanels).filter((id) => panels.has(id))
    );
  }
  if (!activePanels || !activePanels.size) {
    activePanels = new Set(defaultOpen);
  }

  applyState({ state: activePanels, toggles, panels });

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.dataset.panelToggle;
      if (!targetId) {
        return;
      }

      if (activePanels.has(targetId)) {
        activePanels.delete(targetId);
      } else {
        activePanels.add(targetId);
      }

      applyState({ state: activePanels, toggles, panels });
      writeStoredState(storageKey, activePanels);
    });
  });
}

export function initializePanelToggles(root = document) {
  const containers = Array.from(root.querySelectorAll('[data-panel-root]'));
  containers.forEach(initializeContainer);
}
