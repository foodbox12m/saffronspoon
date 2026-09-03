export type TraySize = 'full' | 'half';

export interface MenuCategory {
  id: string;
  name: string;
  blurb?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Integer cents. `half` is null for full-tray-only items. */
  prices: { full: number; half: number | null };
  spice?: number;
  protein?: string;
  allergens?: string[];
  dietary?: string[];
  pairings?: string[];
  aliases?: string[];
  popular?: boolean;
  fullTrayOnly?: boolean;
  unit?: string;
  minOrder?: number;
  notes?: string;
}

export interface TrayServings {
  full: { min: number; max: number };
  half: { min: number; max: number };
}

export interface Menu {
  currency: string;
  note?: string;
  trayServings?: TrayServings;
  categories: MenuCategory[];
  items: MenuItem[];
}

export interface CartLine {
  itemId: string;
  size: TraySize;
  quantity: number;
}

export interface QuoteLine {
  itemId: string;
  size: TraySize;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  name?: string;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  taxCents: number;
  deliveryCents: number;
  totalCents: number;
}

export interface EventDetails {
  name: string;
  phone: string;
  date: string;
  guestCount: string;
  address: string;
  notes: string;
}

export interface OrderResponse {
  orderId: string;
  memoCode: string;
  totalCents: number;
  status: string;
}

export interface CateringSelection {
  itemId: string;
  quantity: number;
}

export interface CateringInquiry {
  name: string;
  email: string;
  phone: string;
  eventDate: string;
  guestCount: string;
  selectedItems: CateringSelection[];
  specialRequests: string;
  estimatedTotalCents?: number;
}

export interface GuestCountOption {
  label: string;
  value: string;
}
