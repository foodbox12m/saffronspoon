const raw = import.meta.env;

export const API_BASE_URL: string = (raw.VITE_API_BASE_URL ?? '').toString().replace(/\/+$/, '');
export const ZELLE_ID: string = (raw.VITE_ZELLE_ID ?? '').toString() || 'orders@saffronandspoon.com';
export const WHATSAPP_NUMBER: string = (raw.VITE_WHATSAPP_NUMBER ?? '').toString().replace(/\D/g, '') || '15103999156';
export const HAS_API = API_BASE_URL.length > 0;
