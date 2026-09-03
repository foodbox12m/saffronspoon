/**
 * Persistence layer.
 *
 * Two interchangeable backends behind one interface:
 *   * SupabaseStore — used when SUPABASE_URL and the service-role key are set.
 *   * MemoryStore   — an in-process fallback so `npm start` works with zero
 *                     setup, for local development and demos.
 *
 * The fallback is deliberate, not lazy: a catering owner should be able to run
 * the agent and take an order before they have created any cloud account. The
 * boot log states plainly which backend is live so nobody mistakes in-memory
 * data for durable data.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type {
  Conversation,
  ConversationTurn,
  CustomerInfo,
  EventInfo,
  Order,
  OrderLine,
  OrderStatus,
  PaymentStatus,
} from '../types.js';
import { auditLog, type AuditEntry } from '../security/audit.js';
import { generateMemoCode } from '../payments/zelle.js';

export interface CreateOrderInput {
  ownerSubject: string;
  channel: Order['channel'];
  customer: CustomerInfo;
  event: EventInfo;
  lines: OrderLine[];
  subtotalCents: number;
  taxCents: number;
  deliveryCents: number;
  totalCents: number;
  depositDueCents: number;
  servesMin: number;
  servesMax: number;
  currency: string;
}

export interface Store {
  readonly backend: 'supabase' | 'memory';

  createOrder(input: CreateOrderInput): Promise<Order>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderByMemoCode(memoCode: string): Promise<Order | null>;
  listOrdersByOwner(ownerSubject: string, limit?: number): Promise<Order[]>;
  listOrdersByPaymentStatus(status: PaymentStatus, limit?: number): Promise<Order[]>;
  claimPayment(orderId: string, input: { note?: string; proofUrl?: string }): Promise<Order>;
  verifyPayment(orderId: string, input: { staffId: string; accepted: boolean; reason?: string }): Promise<Order>;
  setOrderStatus(orderId: string, status: OrderStatus): Promise<Order>;

  getConversation(channel: Conversation['channel'], participant: string): Promise<Conversation>;
  saveConversation(conversation: Conversation): Promise<void>;
  appendTurn(conversationId: string, turn: ConversationTurn): Promise<void>;

  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// -----------------------------------------------------------------------------
// In-memory store
// -----------------------------------------------------------------------------

class MemoryStore implements Store {
  readonly backend = 'memory' as const;

  private readonly orders = new Map<string, Order>();
  private readonly ordersByMemo = new Map<string, string>();
  private readonly conversations = new Map<string, Conversation>();

  private async freshMemoCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generateMemoCode();
      if (!this.ordersByMemo.has(code)) return code;
    }
    throw new Error('Could not allocate a unique memo code.');
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const id = randomId();
    const memoCode = await this.freshMemoCode();
    const timestamp = nowIso();

    const order: Order = {
      id,
      memoCode,
      status: 'awaiting_payment',
      paymentStatus: 'unpaid',
      customer: input.customer,
      event: input.event,
      lines: input.lines,
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents,
      deliveryCents: input.deliveryCents,
      totalCents: input.totalCents,
      depositDueCents: input.depositDueCents,
      currency: input.currency,
      channel: input.channel,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.orders.set(id, order);
    this.ordersByMemo.set(memoCode, id);
    return order;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) ?? null;
  }

  async getOrderByMemoCode(memoCode: string): Promise<Order | null> {
    const id = this.ordersByMemo.get(memoCode.toUpperCase());
    return id ? (this.orders.get(id) ?? null) : null;
  }

  async listOrdersByOwner(ownerSubject: string, limit = 20): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => this.ownerOf(order) === ownerSubject)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listOrdersByPaymentStatus(status: PaymentStatus, limit = 50): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => order.paymentStatus === status)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit);
  }

  /** Memory store keeps the owner on the order's customer phone/subject. */
  private readonly owners = new Map<string, string>();

  private ownerOf(order: Order): string {
    return this.owners.get(order.id) ?? order.customer.phone;
  }

  rememberOwner(orderId: string, ownerSubject: string): void {
    this.owners.set(orderId, ownerSubject);
  }

  async claimPayment(orderId: string, input: { note?: string; proofUrl?: string }): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.status === 'cancelled') throw new Error('That order was cancelled.');

    const updated: Order = {
      ...order,
      paymentStatus: 'claimed',
      status: 'payment_claimed',
      claimNote: input.note,
      proofUrl: input.proofUrl,
      updatedAt: nowIso(),
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  async verifyPayment(
    orderId: string,
    input: { staffId: string; accepted: boolean; reason?: string },
  ): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);

    const updated: Order = {
      ...order,
      paymentStatus: input.accepted ? 'verified' : 'rejected',
      status: input.accepted ? 'confirmed' : 'awaiting_payment',
      verifiedBy: input.staffId,
      verifiedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  async setOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (order.status === 'cancelled' && status !== 'cancelled') {
      throw new Error('A cancelled order cannot be reopened.');
    }
    const updated: Order = { ...order, status, updatedAt: nowIso() };
    this.orders.set(orderId, updated);
    return updated;
  }

  async getConversation(channel: Conversation['channel'], participant: string): Promise<Conversation> {
    const key = `${channel}:${participant}`;
    const existing = this.conversations.get(key);
    if (existing) return existing;

    const conversation: Conversation = {
      id: randomId(),
      channel,
      participant,
      turns: [],
      cart: [],
      draft: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.conversations.set(key, conversation);
    return conversation;
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    conversation.updatedAt = nowIso();
    // Bound history so a long-running chat cannot grow without limit.
    if (conversation.turns.length > 40) {
      conversation.turns = conversation.turns.slice(-40);
    }
    this.conversations.set(`${conversation.channel}:${conversation.participant}`, conversation);
  }

  async appendTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    for (const conversation of this.conversations.values()) {
      if (conversation.id === conversationId) {
        conversation.turns.push(turn);
        await this.saveConversation(conversation);
        return;
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return {
      ok: true,
      detail: `in-memory store — ${this.orders.size} order(s). Data is lost on restart.`,
    };
  }
}

// -----------------------------------------------------------------------------
// Supabase store
// -----------------------------------------------------------------------------

interface OrderRow {
  id: string;
  memo_code: string;
  owner_subject: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  channel: Order['channel'];
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  event_date: string;
  guest_count: number;
  delivery_address: string;
  notes: string;
  subtotal_cents: number;
  tax_cents: number;
  delivery_cents: number;
  total_cents: number;
  deposit_due_cents: number;
  currency: string;
  serves_min: number;
  serves_max: number;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  order_lines?: OrderLineRow[];
}

interface OrderLineRow {
  item_id: string;
  item_name: string;
  size: 'full' | 'half';
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  serves_min: number;
  serves_max: number;
}

function rowToOrder(row: OrderRow): Order {
  const order: Order = {
    id: row.id,
    memoCode: row.memo_code,
    status: row.status,
    paymentStatus: row.payment_status,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      ...(row.customer_email ? { email: row.customer_email } : {}),
    },
    event: {
      date: row.event_date,
      guestCount: row.guest_count,
      address: row.delivery_address,
      notes: row.notes,
    },
    lines: (row.order_lines ?? []).map((line) => ({
      itemId: line.item_id,
      name: line.item_name,
      size: line.size,
      quantity: line.quantity,
      unitPriceCents: line.unit_price_cents,
      lineTotalCents: line.line_total_cents,
      servesMin: line.serves_min,
      servesMax: line.serves_max,
    })),
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    deliveryCents: row.delivery_cents,
    totalCents: row.total_cents,
    depositDueCents: row.deposit_due_cents,
    currency: row.currency,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.verified_by) order.verifiedBy = row.verified_by;
  if (row.verified_at) order.verifiedAt = row.verified_at;
  return order;
}

const ORDER_SELECT = `
  id, memo_code, owner_subject, status, payment_status, channel,
  customer_name, customer_phone, customer_email,
  event_date, guest_count, delivery_address, notes,
  subtotal_cents, tax_cents, delivery_cents, total_cents, deposit_due_cents,
  currency, serves_min, serves_max, verified_by, verified_at, created_at, updated_at,
  order_lines ( item_id, item_name, size, quantity, unit_price_cents, line_total_cents, serves_min, serves_max )
`;

class SupabaseStore implements Store {
  readonly backend = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private async allocateMemoCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generateMemoCode();
      const { data, error } = await this.client.from('orders').select('id').eq('memo_code', code).maybeSingle();
      if (error) throw new Error(`Memo code check failed: ${error.message}`);
      if (!data) return code;
    }
    throw new Error('Could not allocate a unique memo code after 12 attempts.');
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const memoCode = await this.allocateMemoCode();

    const { data, error } = await this.client
      .from('orders')
      .insert({
        memo_code: memoCode,
        owner_subject: input.ownerSubject,
        status: 'awaiting_payment',
        payment_status: 'unpaid',
        channel: input.channel,
        customer_name: input.customer.name,
        customer_phone: input.customer.phone,
        customer_email: input.customer.email ?? null,
        event_date: input.event.date,
        guest_count: input.event.guestCount,
        delivery_address: input.event.address,
        notes: input.event.notes ?? '',
        subtotal_cents: input.subtotalCents,
        tax_cents: input.taxCents,
        delivery_cents: input.deliveryCents,
        total_cents: input.totalCents,
        deposit_due_cents: input.depositDueCents,
        currency: input.currency,
        serves_min: input.servesMin,
        serves_max: input.servesMax,
      })
      .select('id, memo_code')
      .single();

    if (error || !data) throw new Error(`Could not create order: ${error?.message ?? 'no row returned'}`);

    const lineRows = input.lines.map((line) => ({
      order_id: data.id,
      item_id: line.itemId,
      item_name: line.name,
      size: line.size,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      serves_min: line.servesMin,
      serves_max: line.servesMax,
    }));

    const { error: linesError } = await this.client.from('order_lines').insert(lineRows);
    if (linesError) {
      // Roll back the header so we never leave an order with no lines.
      await this.client.from('orders').delete().eq('id', data.id);
      throw new Error(`Could not save order lines: ${linesError.message}`);
    }

    // Open the payment record the customer will later claim against.
    const { error: paymentError } = await this.client.from('payments').insert({
      order_id: data.id,
      method: 'zelle',
      status: 'unpaid',
      amount_cents: input.totalCents,
      memo_code: memoCode,
      zelle_id: config.payments.zelleId,
    });
    if (paymentError) throw new Error(`Could not open payment record: ${paymentError.message}`);

    const created = await this.getOrder(data.id);
    if (!created) throw new Error('Order vanished immediately after creation.');
    return created;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const { data, error } = await this.client.from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle();
    if (error) throw new Error(`Could not load order: ${error.message}`);
    return data ? rowToOrder(data as unknown as OrderRow) : null;
  }

  async getOrderByMemoCode(memoCode: string): Promise<Order | null> {
    const { data, error } = await this.client
      .from('orders')
      .select(ORDER_SELECT)
      .eq('memo_code', memoCode.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(`Could not load order by memo code: ${error.message}`);
    return data ? rowToOrder(data as unknown as OrderRow) : null;
  }

  /** Owner subject for the policy gate's ownership check. */
  async getOrderOwner(orderId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('orders')
      .select('owner_subject')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw new Error(`Could not load order owner: ${error.message}`);
    return (data as { owner_subject: string } | null)?.owner_subject ?? null;
  }

  async listOrdersByOwner(ownerSubject: string, limit = 20): Promise<Order[]> {
    const { data, error } = await this.client
      .from('orders')
      .select(ORDER_SELECT)
      .eq('owner_subject', ownerSubject)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not list orders: ${error.message}`);
    return (data as unknown as OrderRow[]).map(rowToOrder);
  }

  async listOrdersByPaymentStatus(status: PaymentStatus, limit = 50): Promise<Order[]> {
    const { data, error } = await this.client
      .from('orders')
      .select(ORDER_SELECT)
      .eq('payment_status', status)
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Could not list orders by payment status: ${error.message}`);
    return (data as unknown as OrderRow[]).map(rowToOrder);
  }

  async claimPayment(orderId: string, input: { note?: string; proofUrl?: string }): Promise<Order> {
    const { error } = await this.client
      .from('payments')
      .update({
        status: 'claimed',
        claim_note: input.note ?? null,
        proof_object_path: input.proofUrl ?? null,
        claimed_at: nowIso(),
      })
      .eq('order_id', orderId)
      .neq('status', 'verified');

    if (error) throw new Error(`Could not record payment claim: ${error.message}`);

    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    return order;
  }

  async verifyPayment(
    orderId: string,
    input: { staffId: string; accepted: boolean; reason?: string },
  ): Promise<Order> {
    const { error } = await this.client
      .from('payments')
      .update({
        status: input.accepted ? 'verified' : 'rejected',
        verified_by: input.staffId,
        verified_at: nowIso(),
        rejected_reason: input.accepted ? null : (input.reason ?? 'No reason given'),
      })
      .eq('order_id', orderId);

    if (error) throw new Error(`Could not verify payment: ${error.message}`);

    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    return order;
  }

  async setOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const { error } = await this.client.from('orders').update({ status }).eq('id', orderId);
    if (error) throw new Error(`Could not update order status: ${error.message}`);
    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    return order;
  }

  /** Short-lived signed upload URL so proof images never pass through our API. */
  async createProofUploadUrl(orderId: string, filename: string): Promise<{ path: string; signedUrl: string }> {
    const safeName = filename.replace(/[^\w.-]/g, '_').slice(-80);
    const path = `${orderId}/${Date.now()}-${safeName}`;
    const { data, error } = await this.client.storage
      .from(config.supabase.proofBucket)
      .createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message ?? 'unknown'}`);
    return { path, signedUrl: data.signedUrl };
  }

  /** Staff-only, time-limited read URL for a stored proof. */
  async createProofViewUrl(objectPath: string, expiresInSeconds = 300): Promise<string> {
    const { data, error } = await this.client.storage
      .from(config.supabase.proofBucket)
      .createSignedUrl(objectPath, expiresInSeconds);
    if (error || !data) throw new Error(`Could not sign proof URL: ${error?.message ?? 'unknown'}`);
    return data.signedUrl;
  }

  async getConversation(channel: Conversation['channel'], participant: string): Promise<Conversation> {
    const { data, error } = await this.client
      .from('conversations')
      .select('id, channel, participant, cart, draft, created_at, updated_at')
      .eq('channel', channel)
      .eq('participant', participant)
      .maybeSingle();

    if (error) throw new Error(`Could not load conversation: ${error.message}`);

    if (data) {
      const row = data as {
        id: string;
        channel: Conversation['channel'];
        participant: string;
        cart: Conversation['cart'];
        draft: Conversation['draft'];
        created_at: string;
        updated_at: string;
      };

      const { data: turnRows, error: turnsError } = await this.client
        .from('conversation_turns')
        .select('role, content, tool_name')
        .eq('conversation_id', row.id)
        .order('created_at', { ascending: true })
        .limit(40);
      if (turnsError) throw new Error(`Could not load turns: ${turnsError.message}`);

      return {
        id: row.id,
        channel: row.channel,
        participant: row.participant,
        cart: row.cart ?? [],
        draft: row.draft ?? {},
        turns: (turnRows ?? []).map((turn) => {
          const record = turn as { role: ConversationTurn['role']; content: string; tool_name: string | null };
          return {
            role: record.role,
            content: record.content,
            ...(record.tool_name ? { toolName: record.tool_name } : {}),
          };
        }),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }

    const { data: inserted, error: insertError } = await this.client
      .from('conversations')
      .insert({ channel, participant, cart: [], draft: {} })
      .select('id, created_at, updated_at')
      .single();
    if (insertError || !inserted) {
      throw new Error(`Could not create conversation: ${insertError?.message ?? 'no row'}`);
    }

    const row = inserted as { id: string; created_at: string; updated_at: string };
    return {
      id: row.id,
      channel,
      participant,
      turns: [],
      cart: [],
      draft: {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const { error } = await this.client
      .from('conversations')
      .update({ cart: conversation.cart, draft: conversation.draft })
      .eq('id', conversation.id);
    if (error) throw new Error(`Could not save conversation: ${error.message}`);
  }

  async appendTurn(conversationId: string, turn: ConversationTurn): Promise<void> {
    const { error } = await this.client.from('conversation_turns').insert({
      conversation_id: conversationId,
      role: turn.role,
      content: turn.content,
      tool_name: turn.toolName ?? null,
    });
    if (error) throw new Error(`Could not append turn: ${error.message}`);
  }

  /** Durable sink for the hash-chained audit log. */
  async persistAuditEntry(entry: AuditEntry): Promise<void> {
    const { error } = await this.client.from('audit_log').insert({
      seq: entry.seq,
      at: entry.at,
      actor: entry.actor,
      actor_role: entry.actorRole,
      action: entry.action,
      outcome: entry.outcome,
      target: entry.target ?? null,
      reason: entry.reason ?? null,
      meta: entry.meta ?? null,
      prev_hash: entry.prevHash,
      hash: entry.hash,
    });
    if (error) throw new Error(`Could not persist audit entry: ${error.message}`);
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const { error } = await this.client.from('menu_items').select('id').limit(1);
    if (error) return { ok: false, detail: `Supabase unreachable: ${error.message}` };
    return { ok: true, detail: 'Supabase connected.' };
  }
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;

  if (config.supabase.enabled) {
    const supabaseStore = new SupabaseStore(config.supabase.url, config.supabase.serviceRoleKey);
    auditLog.setSink({ persist: (entry) => supabaseStore.persistAuditEntry(entry) });
    store = supabaseStore;
  } else {
    if (config.isProd) {
      // Refusing here would strand a deploy that is otherwise fine, but silently
      // losing orders is worse than a loud warning on every boot.
      // eslint-disable-next-line no-console
      console.warn(
        '[store] PRODUCTION with no Supabase credentials — orders will be lost on restart. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    store = new MemoryStore();
  }

  return store;
}

/** Narrowed accessor for Supabase-only features (signed URLs). */
export function getSupabaseStore(): SupabaseStore | null {
  const active = getStore();
  return active instanceof SupabaseStore ? active : null;
}

export { MemoryStore, SupabaseStore };
