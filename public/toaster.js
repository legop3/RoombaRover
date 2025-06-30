function showToast(message, type = 'success') {
    const toast = document.createElement('div');

    const baseStyle = "px-4 py-3 rounded-lg shadow-md text-white transition-opacity duration-300";
    const typeStyles = {
      success: "bg-green-500",
      error: "bg-red-500",
      info: "bg-blue-500",
      warning: "bg-yellow-500 text-black"
    };

    toast.className = `${baseStyle} ${typeStyles[type] || typeStyles.success}`;
    toast.textContent = message;

    // Append to container
    const container = document.getElementById('toast-container');
    container.appendChild(toast);

    // Fade out and remove after 3 seconds
    setTimeout(() => {
      toast.classList.add("opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }