const inrFormatters = new Map<number, Intl.NumberFormat>();

export function formatInr(value: number, digits = 0) {
  let formatter = inrFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      useGrouping: true,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    inrFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}
