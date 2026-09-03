/** Shared domain types. All money is integer cents — never floats. */

export type TraySize = 'full' | 'half';

export interface MenuCategory {
  id: string;
  name: string;
  blurb: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  description: string;
  prices: { full: number; half: number | null };
  spice: number;
  protein: string;
  allergens: string[];
  dietary: string[];
  pairings: string[];
  aliases: string[];
  popular?: boolean;
  fullTrayOnly?: boolean;
}

export interface Menu {
  currency: string;
  note: string;
  trayServings: Record<TraySize, { min: number; max: number }>;
  categories: MenuCategory[];
  items: MenuItem[];
}

export interface OrderLineInput {
  itemId: string;
  size: TraySize;
  quantity: number;
}

export interface OrderLine {
  itemId: string;
  name: string;
  size: TraySize;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  servesMin: number;
  servesMax: number;
}

export interface Quote {
  lines: OrderLine[];
  subtotalCents: number;
  taxCents: number;
  deliveryCents: number;
  totalCents: number;
  depositDueCents: number;
  servesMin: number;
  servesMax: number;
  currency: string;
  /** Human-readable warnings, e.g. "not enough food for 60 guests". */
  notices: string[];
}

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'payment_claimed'
  | 'payment_verified'
  | 'confirmed'
  | 'fulfilled'
  | 'cancelled';

export type PaymentStatus = 'unpaid' | 'claimed' | 'verified' | 'rejected' | 'refunded';

export interface CustomerInfo {
  name: string;
  phone: string;
  email?: string;
}

export interface EventInfo {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  guestCount: number;
  address: string;
  notes?: string;
}

export interface Order {
  id: string;
  memoCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  customer: CustomerInfo;
  event: EventInfo;
  lines: OrderLine[];
  subtotalCents: number;
  taxCents: number;
  deliveryCents: number;
  totalCents: number;
  depositDueCents: number;
  currency: string;
  channel: 'web' | 'whatsapp' | 'staff';
  proofUrl?: string;
  claimNote?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentClaim {
  orderId: string;
  note?: string;
  proofUrl?: string;
  claimedAt: string;
}

export interface KbDocument {
  id: string;
  title: string;
  body: string;
  source: string;
  tags: string[];
  /** Optional link back to a menu item. */
  itemId?: string;
}

export interface KbHit {
  doc: KbDocument;
  score: number;
  snippet: string;
}

export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
}

export interface Conversation {
  id: string;
  channel: 'web' | 'whatsapp';
  /** WhatsApp number or web session id. */
  participant: string;
  turns: ConversationTurn[];
  /** Items the customer has tentatively selected during the chat. */
  cart: OrderLineInput[];
  draft: Partial<CustomerInfo & EventInfo>;
  createdAt: string;
  updatedAt: string;
}
