function activatePanel(container, targetId) {
  const panels = container.querySelectorAll('[data-tab-panel]');
  const triggers = container.querySelectorAll('[data-tab-target]');

  panels.forEach((panel) => {
    const isActive = panel.id === targetId;
    panel.classList.toggle('hidden', !isActive);
    panel.setAttribute('aria-hidden', String(!isActive));
  });

  triggers.forEach((trigger) => {
    const triggerTarget = trigger.getAttribute('data-tab-target');
    const isActive = triggerTarget === targetId;
    trigger.setAttribute('aria-selected', String(isActive));
    trigger.setAttribute('data-tab-active', isActive ? 'true' : 'false');
    trigger.classList.toggle('bg-gray-300', isActive);
    trigger.classList.toggle('text-gray-900', isActive);
    // trigger.classList.toggle('border-gray-100', isActive);
    trigger.classList.toggle('bg-gray-800', !isActive);
    trigger.classList.toggle('text-gray-200', !isActive);
    // trigger.classList.toggle('border-gray-600', !isActive);
  });
}

function resolveDefaultTarget(container) {
  const defaultTrigger = container.querySelector('[data-tab-default]');
  if (defaultTrigger && defaultTrigger.hasAttribute('data-tab-target')) {
    // defaultTrigger.classList.add('bg-gray-300', 'text-gray-900', 'border-gray-100');
    // defaultTrigger.classList.remove('bg-gray-800', 'text-gray-200', 'border-gray-600');
    return defaultTrigger.getAttribute('data-tab-target');
  }

  const firstTrigger = container.querySelector('[data-tab-target]');
  return firstTrigger ? firstTrigger.getAttribute('data-tab-target') : null;
}

export function initializeTabs(root = document) {
  const containers = root.querySelectorAll('[data-tab-root]');

  containers.forEach((container) => {
    const triggers = container.querySelectorAll('[data-tab-target]');
    if (!triggers.length) {
      return;
    }

    const defaultTarget = resolveDefaultTarget(container);
    if (defaultTarget) {
      activatePanel(container, defaultTarget);
    }

    triggers.forEach((trigger) => {
      trigger.type = trigger.type || 'button';
      trigger.addEventListener('click', () => {
        const targetId = trigger.getAttribute('data-tab-target');
        if (!targetId) {
          return;
        }
        activatePanel(container, targetId);
      });
    });
  });
}
