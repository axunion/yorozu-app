/** The customer order URL a seat's QR code points at. */
export function orderUrl(qrToken: string): string {
  const orderBase =
    (import.meta as { env?: Record<string, string> }).env?.VITE_ORDER_BASE ??
    "";
  return `${orderBase}/${qrToken}`;
}
