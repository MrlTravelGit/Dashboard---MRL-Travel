/**
 * Utilitários pequenos e estáveis de formatação.
 *
 * Motivo: alguns componentes (ex: CarRentalCard) precisam de formatação
 * e o build no Linux é sensível a caminhos inexistentes.
 */

export function formatCurrency(
  value: number | null | undefined,
  currency: string = "BRL",
  locale: string = "pt-BR",
): string {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Fallback seguro, nunca quebrar a UI.
    return String(n);
  }
}
