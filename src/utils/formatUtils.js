export const getOrdinalSuffix = (num) => {
  if (num === null || num === undefined || num === '') return '';
  const n = parseInt(num, 10);
  if (isNaN(n)) return num; // If it's not a pure number (e.g., "Batch A"), just return it.
  
  const j = n % 10,
        k = n % 100;
  if (j == 1 && k != 11) {
    return n + "st";
  }
  if (j == 2 && k != 12) {
    return n + "nd";
  }
  if (j == 3 && k != 13) {
    return n + "rd";
  }
  return n + "th";
};
