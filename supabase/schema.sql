-- =============================================================================
-- saffron & spoon — catering ordering schema
--
-- Conventions enforced throughout:
--   * All money is BIGINT cents. There is no numeric/float money column.
--   * Every table has RLS enabled and denies anon by default. The server talks
--     to Postgres with the service-role key and does its own authorisation in
--     server/src/security/policy.ts; RLS is the second line of defence so a
--     leaked anon key cannot read orders or payment proofs.
--   * Payment proof images live in a PRIVATE storage bucket. Customers upload
--     via signed URL; only staff can read.
--   * audit_log is append-only and hash-chained; UPDATE and DELETE are revoked.
--
-- Apply with:  psql "$SUPABASE_DB_URL" -f supabase/schema.sql
-- =============================================================================

begin;

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type tray_size as enum ('full', 'half');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum (
    'draft', 'awaiting_payment', 'payment_claimed', 'payment_verified',
    'confirmed', 'fulfilled', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid', 'claimed', 'verified', 'rejected', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_channel as enum ('web', 'whatsapp', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_outcome as enum ('allowed', 'denied', 'error');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 1. menu_categories
-- =============================================================================
create table if not exists menu_categories (
  id          text primary key,
  name        text not null,
  blurb       text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_menu_categories_updated on menu_categories;
create trigger trg_menu_categories_updated
  before update on menu_categories
  for each row execute function set_updated_at();

-- =============================================================================
-- 2. menu_items
--    Mirrors server/src/data/menu.json. The JSON file remains the source of
--    truth for pricing at runtime; this table exists for reporting and for the
--    staff admin UI.
-- =============================================================================
create table if not exists menu_items (
  id                text primary key,
  name              text not null,
  category_id       text not null references menu_categories(id) on update cascade,
  description       text not null default '',
  full_price_cents  bigint not null check (full_price_cents > 0),
  half_price_cents  bigint check (half_price_cents is null or half_price_cents > 0),
  spice             smallint not null default 0 check (spice between 0 and 5),
  protein           text not null default 'none',
  allergens         text[] not null default '{}',
  dietary           text[] not null default '{}',
  aliases           text[] not null default '{}',
  pairings          text[] not null default '{}',
  is_popular        boolean not null default false,
  full_tray_only    boolean not null default false,
  is_available      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A full-tray-only item must not carry a half price, and vice versa.
  constraint half_price_matches_flag check (
    (full_tray_only and half_price_cents is null)
    or (not full_tray_only and half_price_cents is not null)
  )
);

create index if not exists idx_menu_items_category on menu_items(category_id);
create index if not exists idx_menu_items_available on menu_items(is_available) where is_available;
create index if not exists idx_menu_items_name_trgm on menu_items using gin (name gin_trgm_ops);

drop trigger if exists trg_menu_items_updated on menu_items;
create trigger trg_menu_items_updated
  before update on menu_items
  for each row execute function set_updated_at();

-- =============================================================================
-- 3. customers
--    `subject` is the stable identity used by the JWT (whatsapp:+1..., web:...).
-- =============================================================================
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  subject     text not null unique,
  name        text not null default '',
  phone       text not null default '',
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_customers_phone on customers(phone);

drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated
  before update on customers
  for each row execute function set_updated_at();

-- =============================================================================
-- 4. orders
--    Totals are stored, not recomputed on read, so a menu price change never
--    retroactively alters a placed order. `owner_subject` drives the
--    order:read:own ownership check in the application policy gate.
-- =============================================================================
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  memo_code           text not null unique,
  owner_subject       text not null,
  customer_id         uuid references customers(id) on delete set null,
  status              order_status not null default 'draft',
  payment_status      payment_status not null default 'unpaid',
  channel             order_channel not null default 'web',

  customer_name       text not null default '',
  customer_phone      text not null default '',
  customer_email      text,

  event_date          date not null,
  guest_count         integer not null check (guest_count > 0),
  delivery_address    text not null default '',
  notes               text not null default '',

  subtotal_cents      bigint not null check (subtotal_cents >= 0),
  tax_cents           bigint not null check (tax_cents >= 0),
  delivery_cents      bigint not null default 0 check (delivery_cents >= 0),
  total_cents         bigint not null check (total_cents >= 0),
  deposit_due_cents   bigint not null default 0 check (deposit_due_cents >= 0),
  currency            text not null default 'USD',

  serves_min          integer not null default 0,
  serves_max          integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The stored total must be internally consistent. Guards against a bad write
  -- path ever persisting a total that does not equal its parts.
  constraint total_is_consistent check (total_cents = subtotal_cents + tax_cents + delivery_cents),
  constraint deposit_within_total check (deposit_due_cents <= total_cents),
  constraint memo_code_format check (memo_code ~ '^SS-[0-9A-HJ-NP-Z]{5}$')
);

create index if not exists idx_orders_owner on orders(owner_subject);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_payment_status on orders(payment_status);
create index if not exists idx_orders_event_date on orders(event_date);
create index if not exists idx_orders_created on orders(created_at desc);

drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated
  before update on orders
  for each row execute function set_updated_at();

-- Only staff-verified payments may move an order into a paid state. This is a
-- database-level backstop for the rule the agent is not allowed to break.
create or replace function guard_order_transition()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'verified' and old.payment_status <> 'verified' then
    if new.verified_by is null then
      raise exception 'payment_status=verified requires verified_by (staff attribution)';
    end if;
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled order cannot be reopened';
  end if;

  return new;
end;
$$;

alter table orders add column if not exists verified_by text;
alter table orders add column if not exists verified_at timestamptz;

drop trigger if exists trg_orders_transition on orders;
create trigger trg_orders_transition
  before update on orders
  for each row execute function guard_order_transition();

-- =============================================================================
-- 5. order_lines
--    Unit price is snapshotted at order time. line_total is a generated column
--    so it can never drift from quantity × unit price.
-- =============================================================================
create table if not exists order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  item_id           text not null,
  item_name         text not null,
  size              tray_size not null,
  quantity          integer not null check (quantity > 0 and quantity <= 20),
  unit_price_cents  bigint not null check (unit_price_cents > 0),
  line_total_cents  bigint generated always as (unit_price_cents * quantity) stored,
  serves_min        integer not null default 0,
  serves_max        integer not null default 0,
  created_at        timestamptz not null default now(),
  unique (order_id, item_id, size)
);

create index if not exists idx_order_lines_order on order_lines(order_id);

-- =============================================================================
-- 6. payments
--    One row per payment attempt against an order. Zelle is out-of-band, so a
--    payment is a claim until a named staff member verifies it.
-- =============================================================================
create table if not exists payments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  method            text not null default 'zelle',
  status            payment_status not null default 'unpaid',
  amount_cents      bigint not null check (amount_cents >= 0),
  memo_code         text not null,
  zelle_id          text not null default '',
  -- Storage object path in the PRIVATE payment-proofs bucket. Never a public URL.
  proof_object_path text,
  claim_note        text,
  claimed_at        timestamptz,
  verified_by       text,
  verified_at       timestamptz,
  rejected_reason   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint verified_needs_attribution check (
    status <> 'verified' or (verified_by is not null and verified_at is not null)
  )
);

create index if not exists idx_payments_order on payments(order_id);
create index if not exists idx_payments_status on payments(status);
create unique index if not exists idx_payments_memo_pending
  on payments(memo_code) where status in ('claimed', 'verified');

drop trigger if exists trg_payments_updated on payments;
create trigger trg_payments_updated
  before update on payments
  for each row execute function set_updated_at();

-- Keep orders.payment_status in lockstep with the payment row.
create or replace function sync_order_payment_status()
returns trigger
language plpgsql
as $$
begin
  update orders
     set payment_status = new.status,
         verified_by    = coalesce(new.verified_by, orders.verified_by),
         verified_at    = coalesce(new.verified_at, orders.verified_at),
         status = case
           when new.status = 'verified' then 'confirmed'::order_status
           when new.status = 'claimed'  then 'payment_claimed'::order_status
           when new.status = 'rejected' then 'awaiting_payment'::order_status
           else orders.status
         end
   where orders.id = new.order_id;
  return new;
end;
$$;

drop trigger if exists trg_payments_sync_order on payments;
create trigger trg_payments_sync_order
  after insert or update of status on payments
  for each row execute function sync_order_payment_status();

-- =============================================================================
-- 7. kb_documents
--    Knowledge base backing ask_knowledge_base. Ingested content (e.g. Uber Eats
--    review text) is untrusted and is fenced before it reaches a prompt.
-- =============================================================================
create table if not exists kb_documents (
  id            text primary key,
  title         text not null,
  body          text not null,
  source        text not null,
  tags          text[] not null default '{}',
  item_id       text references menu_items(id) on delete set null,
  is_trusted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_kb_source on kb_documents(source);
create index if not exists idx_kb_item on kb_documents(item_id);
create index if not exists idx_kb_body_trgm on kb_documents using gin (body gin_trgm_ops);

drop trigger if exists trg_kb_updated on kb_documents;
create trigger trg_kb_updated
  before update on kb_documents
  for each row execute function set_updated_at();

-- =============================================================================
-- 8. conversations
-- =============================================================================
create table if not exists conversations (
  id            uuid primary key default gen_random_uuid(),
  channel       order_channel not null default 'whatsapp',
  participant   text not null,
  cart          jsonb not null default '[]'::jsonb,
  draft         jsonb not null default '{}'::jsonb,
  last_order_id uuid references orders(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (channel, participant)
);

create index if not exists idx_conversations_participant on conversations(participant);

drop trigger if exists trg_conversations_updated on conversations;
create trigger trg_conversations_updated
  before update on conversations
  for each row execute function set_updated_at();

-- =============================================================================
-- 9. conversation_turns
-- =============================================================================
create table if not exists conversation_turns (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  role              text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content           text not null,
  tool_name         text,
  -- Set when the guardrail layer rewrote or blocked the original text.
  guardrail_verdict text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_turns_conversation on conversation_turns(conversation_id, created_at);

-- =============================================================================
-- 10. audit_log
--     Append-only, hash-chained. UPDATE/DELETE are revoked below.
-- =============================================================================
create table if not exists audit_log (
  seq         bigint primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  actor_role  text not null,
  action      text not null,
  outcome     audit_outcome not null,
  target      text,
  reason      text,
  meta        jsonb,
  prev_hash   char(64) not null,
  hash        char(64) not null unique
);

create index if not exists idx_audit_actor on audit_log(actor, at desc);
create index if not exists idx_audit_action on audit_log(action, at desc);
create index if not exists idx_audit_target on audit_log(target) where target is not null;

-- Block tampering at the table level, not just by convention.
create or replace function reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists trg_audit_no_update on audit_log;
create trigger trg_audit_no_update
  before update or delete on audit_log
  for each row execute function reject_audit_mutation();

-- =============================================================================
-- Row Level Security — deny by default everywhere.
-- The server uses the service-role key, which bypasses RLS. These policies
-- exist so that a leaked anon/publishable key is inert.
-- =============================================================================
alter table menu_categories    enable row level security;
alter table menu_items         enable row level security;
alter table customers          enable row level security;
alter table orders             enable row level security;
alter table order_lines        enable row level security;
alter table payments           enable row level security;
alter table kb_documents       enable row level security;
alter table conversations      enable row level security;
alter table conversation_turns enable row level security;
alter table audit_log          enable row level security;

-- The menu is the only genuinely public data.
drop policy if exists menu_categories_public_read on menu_categories;
create policy menu_categories_public_read on menu_categories
  for select to anon, authenticated using (true);

drop policy if exists menu_items_public_read on menu_items;
create policy menu_items_public_read on menu_items
  for select to anon, authenticated using (is_available);

-- Everything else: no policy for anon means no access. Authenticated users may
-- read only their own order, matched on the JWT `sub` claim.
drop policy if exists orders_owner_read on orders;
create policy orders_owner_read on orders
  for select to authenticated
  using (owner_subject = auth.jwt() ->> 'sub');

drop policy if exists order_lines_owner_read on order_lines;
create policy order_lines_owner_read on order_lines
  for select to authenticated
  using (exists (
    select 1 from orders o
     where o.id = order_lines.order_id
       and o.owner_subject = auth.jwt() ->> 'sub'
  ));

drop policy if exists payments_owner_read on payments;
create policy payments_owner_read on payments
  for select to authenticated
  using (exists (
    select 1 from orders o
     where o.id = payments.order_id
       and o.owner_subject = auth.jwt() ->> 'sub'
  ));

-- Nobody but the service role reads the audit log or raw conversations.
revoke all on audit_log from anon, authenticated;
revoke all on conversation_turns from anon, authenticated;
revoke all on conversations from anon, authenticated;
revoke all on customers from anon, authenticated;

-- =============================================================================
-- Private storage bucket for Zelle payment screenshots.
-- Customers upload through a short-lived signed URL minted by the server;
-- reads are staff-only. The bucket is never public.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists proofs_no_anon_read on storage.objects;
create policy proofs_no_anon_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (auth.jwt() ->> 'role') = 'staff'
  );

-- =============================================================================
-- Reporting helpers
-- =============================================================================

-- Payments a staff member needs to look at, oldest claim first.
create or replace view pending_payment_queue as
select p.id            as payment_id,
       o.id            as order_id,
       o.memo_code,
       o.customer_name,
       o.customer_phone,
       o.event_date,
       p.amount_cents,
       p.claim_note,
       p.proof_object_path is not null as has_proof,
       p.claimed_at
  from payments p
  join orders o on o.id = p.order_id
 where p.status = 'claimed'
 order by p.claimed_at asc nulls last;

-- Confirmed revenue by event date, in cents.
create or replace view revenue_by_event_date as
select o.event_date,
       count(*)                     as order_count,
       sum(o.total_cents)           as total_cents,
       sum(o.guest_count)           as guests
  from orders o
 where o.payment_status = 'verified'
   and o.status <> 'cancelled'
 group by o.event_date
 order by o.event_date desc;

commit;
