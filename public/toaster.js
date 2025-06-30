function showToast(message, type = 'success', stack = true) {
    const container = document.getElementById('toast-container');

    // Remove existing toast of the same type if stacking is disabled
    if (!stack) {
      const existing = container.querySelector(`.toast-${type}`);
      if (existing) existing.remove();
    }

    // Create the toast
    const toast = document.createElement('div');
    toast.classList.add(`toast-${type}`); // Used to target by type

    const baseStyle = "px-4 py-3 rounded-lg shadow-md text-white transition-opacity duration-300";
    const typeStyles = {
      success: "bg-green-500",
      error: "bg-red-500",
      info: "bg-blue-500",
      warning: "bg-yellow-500 text-black"
    };

    toast.className += ` ${baseStyle} ${typeStyles[type] || typeStyles.success}`;
    toast.textContent = message;

    // Append toast
    container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
      toast.classList.add("opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }