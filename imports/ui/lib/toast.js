/**
 * toast.js - Simple toast notification utility
 */

/**
 * Show a non-blocking toast notification
 * @param {string} message - Message to display
 * @param {number} duration - How long to show the toast (ms)
 */
export function showToast(message, duration = 2000) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
