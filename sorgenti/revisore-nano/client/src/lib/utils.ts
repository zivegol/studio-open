import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatta un valore numerico come importo in euro con separatori delle migliaia.
 * Accetta number, string (anche con punto decimale anglosassone), null o undefined.
 * Restituisce sempre il formato italiano: 1.234.567,89 €
 */
export function formatCurrency(
  value: number | string | null | undefined,
  options?: { decimali?: number; simbolo?: boolean }
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value.replace(/,/g, ".")) : value;
  if (isNaN(num)) return "—";
  const decimali = options?.decimali ?? 2;
  const simbolo = options?.simbolo !== false;
  const formatted = num.toLocaleString("it-IT", {
    minimumFractionDigits: decimali,
    maximumFractionDigits: decimali,
  });
  return simbolo ? `${formatted} €` : formatted;
}

/**
 * Formatta un valore percentuale con segno e separatore decimale italiano.
 * Es: 12.5 → "+12,5%", -3.2 → "-3,2%"
 */
export function formatPercent(
  value: number | string | null | undefined,
  options?: { decimali?: number; segno?: boolean }
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  const decimali = options?.decimali ?? 1;
  const segno = options?.segno !== false;
  const formatted = num.toLocaleString("it-IT", {
    minimumFractionDigits: decimali,
    maximumFractionDigits: decimali,
  });
  return segno && num > 0 ? `+${formatted}%` : `${formatted}%`;
}
