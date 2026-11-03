// Short amounts, set once in Settings for every section: ₹2,40,000 as ₹2.4L.

export const shortAmounts = () => {
  try {
    return JSON.parse(localStorage.getItem('shortAmounts')) === true;
  } catch {
    return false;
  }
};

// Lakh and crore for rupees, thousand, million and billion for dollars. Small
// amounts stay in full, as shortening them saves nothing.
export function shortMoney(v, currency = 'INR') {
  const size = Math.abs(v);
  const steps = currency === 'INR' ? [[1e7, 'Cr'], [1e5, 'L'], [1e3, 'K']] : [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const [unit, suffix] = steps.find(([n]) => size >= n) ?? [1, ''];
  const scaled = size / unit;
  const digits = !suffix ? (Number.isInteger(scaled) ? 0 : 2) : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${v < 0 ? '-' : ''}${currency === 'USD' ? '$' : '₹'}${Number(scaled.toFixed(digits))}${suffix}`;
}
