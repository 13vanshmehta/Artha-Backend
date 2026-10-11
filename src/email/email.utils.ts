/**
 * Security & Formatting Utilities for Email Templates
 */

/**
 * Escapes untrusted text to prevent HTML injection in rendered emails.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a currency amount with symbol and 2 decimals.
 * Defaults to INR (₹) when currency is 'INR' or not specified.
 */
export function formatEmailCurrency(
  amount: number,
  currency: string = 'INR',
): string {
  const rounded = Math.round(amount * 100) / 100;
  const numFormatted = rounded.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const upper = (currency || 'INR').toUpperCase();
  if (upper === 'INR') {
    return `₹${numFormatted}`;
  }
  if (upper === 'USD') {
    return `$${numFormatted}`;
  }
  if (upper === 'EUR') {
    return `€${numFormatted}`;
  }
  if (upper === 'GBP') {
    return `£${numFormatted}`;
  }
  return `${upper} ${numFormatted}`;
}

/**
 * Formats a standard date for email rendering.
 */
export function formatEmailDate(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toUTCString().replace('GMT', 'UTC');
}
