import { Meteor } from 'meteor/meteor';

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
}

export function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function clearProgressAfterDelay(methodName, ...args) {
  setTimeout(async () => {
    try {
      await Meteor.callAsync(methodName, ...args);
    } catch (error) {
      console.error('Failed to clear progress:', error);
    }
  }, 2000);
}

export function formatDate(date) {
  if (!date) {
    return '-';
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return '-';
  }
  return d.toLocaleDateString();
}
