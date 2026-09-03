# Architecture

How the pieces fit, and why they are arranged this way.

## The central constraint

This system takes money for food that will be cooked before anyone checks whether
the money arrived. Two failure modes are unacceptable:

1. Quoting a price that is wrong.
2. Telling a customer their order is confirmed when no payment was received.

Nearly every structural decision below follows from refusing to let a language model
be the thing standing between those failures and the business.

## Layers

### 1. Channels

Twilio webhook, Baileys socket, and the REST API used by the React app. Their only
job is to turn an inbound event into `{ principal, message }` and send a reply back.
They contain no business logic, which is why the WhatsApp agent and the web app can
never drift apart in behaviour — they are the same code below this line.

`server/src/whatsapp/index.ts` is the one exception: two shortcut commands, "PAID"
and a bare memo code, are handled deterministically before the agent sees them.
Those are the two messages where a model misreading intent costs money, so they do
not go through a model at all.

### 2. Policy gate

Every tool call passes through `security/policy.ts → enforce()`. In order:

1. **Scope check** — does this principal's role carry the required scope?
2. **Ownership check** — for order-scoped operations, does this principal own the
   record, or hold an `:any` scope?
3. **Rate limit** — sliding window per identity, tighter for the agent loop, with an
   escalating penalty on repeated failures.
4. **Audit** — the decision is appended to the hash chain either way, allowed or
   denied.

There is one gate and one code path. A new tool cannot accidentally skip it, because
the tool dispatcher calls `enforce()` before dispatch, not each tool individually.

### 3. Tool layer

Eight tools in `mcp/tools.ts`. This is the complete set of things any agent — ours,
or an external MCP client — can do:

| Tool | Scope required | Notes |
| --- | --- | --- |
| `search_menu` | `menu:read` | Alias-aware lookup over `menu.json`. |
| `ask_knowledge_base` | `kb:read` | BM25 retrieval; results marked untrusted. |
| `quote_order` | `order:quote` | The **only** source of a total. |
| `place_order` | `order:create` | Re-quotes server-side; ignores any client total. |
| `check_order_status` | `order:read:own` | Ownership-checked. |
| `claim_payment` | `payment:claim` | Records a claim. Does not confirm anything. |
| `list_pending_payments` | `payment:read:any` | Staff only. |
| `verify_payment` | `payment:verify` | Staff only. Terminal state change. |

Inputs are validated with zod at the boundary. `callTool()` is the sole entry point,
used identically by the HTTP routes, the agent orchestrator, and the MCP transport.

### 4. Domain

`domain/menu.ts` and `domain/pricing.ts` are pure functions over `data/menu.json`.

Money is integer cents everywhere. There is no float arithmetic in the pricing path,
because `0.1 + 0.2 !== 0.3` and a caterer's invoice is not the place to discover
that. Tax rounds half-up at a single point.

`menu.json` is the one source of truth for prices. `web/scripts/sync-menu.mjs` copies
it into the frontend at build time rather than the frontend keeping its own list, so
the price a customer sees on a card and the price the server charges cannot diverge.

### 5. Agent

`agent/orchestrator.ts` is a bounded loop: send the conversation plus tool schemas to
an OpenAI-compatible endpoint, execute any requested tool calls through `callTool`,
feed the results back, repeat up to `MAX_TOOL_CALLS_PER_TURN`. The bound exists so a
confused model cannot spend the API budget in a loop.

The system prompt in `agent/prompt.ts` carries three hard rules: never state a price
that did not come from `quote_order`, never tell a customer a payment is confirmed,
never offer a discount. These are reinforced structurally — the model has no tool
that could confirm a payment or alter a price — because prompt instructions alone
are a request, not a guarantee.

With no `AGENT_API_KEY`, `fallbackReply()` handles the conversation with
deterministic scripted responses. Every ordering and payment flow still works. The
LLM improves the conversation; it is not load-bearing.

### 6. Knowledge base

`kb/store.ts` is a small BM25 index (k1=1.5, b=0.75) with a food-domain synonym map
and a light stemmer, seeded from the menu plus hand-written policy documents. A
vector database would be more machinery than a menu of eleven dishes justifies, and
BM25 is inspectable — when it returns a wrong passage you can see exactly why.

Retrieved passages are fenced as untrusted before they reach the model.

### 7. Persistence

`db/store.ts` defines a `Store` interface with two implementations: Supabase, and an
in-memory fallback used automatically when Supabase is not configured. The interface
exists so local development needs no external service, and so the fallback is a
deliberate, visible mode — `/health` reports which backend is live — rather than a
silent failure.

`supabase/schema.sql` enforces at the database level what the application also
enforces: money is integer cents, line totals are generated columns rather than
client-supplied, order state transitions are validated by trigger, RLS denies by
default, and audit rows reject UPDATE and DELETE outright.

Payment screenshots go to a private bucket and are served only through short-lived
signed URLs. They are photographs of someone's banking app.

## Request flows

### Placing an order over WhatsApp

```
customer message
  → provider adapter (signature verified)
  → inbound guardrail screening
  → agent orchestrator
      → search_menu / ask_knowledge_base          [policy gate]
      → quote_order                                [policy gate]
      → place_order                                [policy gate]
          → pricing recomputed server-side
          → memo code generated
          → order persisted
  → outbound guardrail screening
  → reply + Zelle instruction + payment page link
  → admin alerted
```

Note that `place_order` re-runs pricing itself and ignores any total present in its
input. A client — or a model — cannot propose a price.

### Confirming a payment

```
customer sends "PAID" (+ optional screenshot)
  → deterministic shortcut, no model involved
  → claim_payment                                  [policy gate]
      → order.paymentStatus = 'claimed'
  → admin alerted with memo code and amount

staff open the verification screen
  → staff token minted from STAFF_ACCESS_CODE
  → list_pending_payments                          [policy gate]
  → human matches memo code against the bank deposit
  → verify_payment                                 [policy gate, staff scope]
      → order.paymentStatus = 'verified'
  → customer messaged: now genuinely confirmed
```

The gap in the middle is a human looking at a bank statement. That is not a
limitation of the implementation — Zelle offers no merchant API, no webhook, and no
reversal — it is the reality of the payment rail, made explicit instead of hidden.

## Deployment shape

GitHub Pages is static-only, so it hosts the landing page and the React app. The
agent, the webhook and the database need a live Node process — Render, via
`render.yaml`. The two halves are joined by `VITE_API_BASE_URL` on the frontend and
`ALLOWED_ORIGINS` on the API.

## What is deliberately not here

- **No payment automation.** See above.
- **No vector database.** Eleven dishes.
- **No queue.** Order volume for a single caterer does not need one; admin alerts
  are fire-and-forget with failures logged.
- **No session store for the agent.** Conversation state is per-message plus the
  order record. Simple, and it means a restart cannot lose an order.
- **No multi-tenancy.** One business, one menu, one Zelle account.
