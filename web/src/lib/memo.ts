const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Local placeholder memo code used only when the API cannot issue one.
 * Same SS-XXXXX shape as the server code, but the order is unconfirmed.
 */
export function localMemoCode(): string {
  let code = '';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return `SS-${code}`;
}
