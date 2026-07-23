/**
 * `amount_spent` is returned by the AdAccount object as an integer in the
 * account currency's minor unit. The Graph API's account amount example is
 * likewise an integer (rather than an Insights decimal amount).
 *
 * We convert only after deriving the number of fraction digits from Intl so
 * JPY/KRW (0), USD/EUR (2), and currencies with other minor-unit conventions
 * are formatted correctly. An unparseable value stays unavailable.
 */
export function formatMetaAmountSpent(
  amountSpent: string | undefined,
  currency: string | undefined,
): string {
  if (!amountSpent || !currency || !/^[-+]?\d+$/.test(amountSpent)) {
    return "-";
  }

  const raw = Number(amountSpent);

  if (!Number.isSafeInteger(raw)) {
    return "-";
  }

  try {
    const formatter = new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency,
    });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
    const value = raw / 10 ** fractionDigits;

    return formatter.format(value);
  } catch {
    return "-";
  }
}
