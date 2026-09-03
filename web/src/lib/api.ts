import { API_BASE_URL, HAS_API } from './env';
import type { CartLine, EventDetails, Menu, OrderResponse, Quote } from '../types';

export class ApiUnavailableError extends Error {
  constructor(message = 'The ordering service is unreachable.') {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!HAS_API) throw new ApiUnavailableError('No API base URL is configured.');
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiUnavailableError();
  }
  if (!response.ok) {
    throw new ApiUnavailableError(`Ordering service returned ${response.status}.`);
  }
  return (await response.json()) as T;
}

const cartPayload = (cart: CartLine[]) =>
  cart.map(({ itemId, size, quantity }) => ({ itemId, size, quantity }));

export const fetchMenu = () => request<Menu>('/api/menu');

export const fetchQuote = (cart: CartLine[]) =>
  request<Quote>('/api/quote', {
    method: 'POST',
    body: JSON.stringify({ items: cartPayload(cart) }),
  });

export const createOrder = (details: EventDetails, cart: CartLine[]) =>
  request<OrderResponse>('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customer: { name: details.name, phone: details.phone },
      event: {
        date: details.date,
        guestCount: Number(details.guestCount) || 0,
        address: details.address,
        notes: details.notes,
      },
      items: cartPayload(cart),
    }),
  });

export const claimPayment = (orderId: string, body: { note?: string; proofUrl?: string }) =>
  request<{ status: string }>(`/api/orders/${encodeURIComponent(orderId)}/claim-payment`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const fetchOrder = (orderId: string) =>
  request<OrderResponse & { status: string }>(`/api/orders/${encodeURIComponent(orderId)}`);
