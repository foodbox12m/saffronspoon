/**
 * Agent orchestrator.
 *
 * A bounded tool-calling loop against any OpenAI-compatible chat completions
 * endpoint. The loop is deliberately small and defensive:
 *
 *   * Inbound text is screened before it enters the transcript.
 *   * The model may take at most `maxToolCallsPerTurn` tool calls per customer
 *     message, so a confused model cannot burn the budget or spin forever.
 *   * Tool errors are handed back to the model as data so it can recover in
 *     conversation rather than crashing the turn.
 *   * Outbound text is screened before it reaches the customer.
 *   * If no model key is configured, the loop degrades to a deterministic reply
 *     instead of failing — the WhatsApp number still works.
 */

import { config } from '../config.js';
import { getStore } from '../db/store.js';
import {
  BLOCKED_REPLY,
  screenInboundMessage,
  screenOutboundMessage,
  type Principal,
} from '../security/index.js';
import { callTool, describeTools } from '../mcp/tools.js';
import type { Conversation, ConversationTurn } from '../types.js';
import { buildSystemPrompt, fallbackReply } from './prompt.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface AgentReply {
  text: string;
  toolCalls: string[];
  blocked: boolean;
  /** Set when the turn ended because the tool budget ran out. */
  truncated: boolean;
}

const HISTORY_TURNS = 16;

function toChatMessages(conversation: Conversation, systemPrompt: string): ChatMessage[] {
  const history = conversation.turns.slice(-HISTORY_TURNS);

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const turn of history) {
    if (turn.role === 'tool') {
      // Replay tool output as an assistant-visible note. We do not attempt to
      // reconstruct tool_call_ids across turns — stale ids confuse the API.
      messages.push({
        role: 'assistant',
        content: `[previous ${turn.toolName ?? 'tool'} result] ${turn.content.slice(0, 900)}`,
      });
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  return messages;
}

async function callModel(
  messages: ChatMessage[],
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): Promise<ChatMessage> {
  const response = await fetch(`${config.agent.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.agent.apiKey}`,
    },
    body: JSON.stringify({
      model: config.agent.model,
      temperature: config.agent.temperature,
      max_tokens: config.agent.maxOutputTokens,
      messages,
      tools: tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
      tool_choice: 'auto',
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Model call failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: ChatMessage }>;
  };

  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error('Model returned no message.');
  return message;
}

/**
 * Handle one customer message end to end.
 */
export async function handleCustomerMessage(input: {
  principal: Principal;
  channel: 'whatsapp' | 'web';
  participant: string;
  message: string;
}): Promise<AgentReply> {
  const store = getStore();
  const conversation = await store.getConversation(input.channel, input.participant);

  // 1. Screen the inbound message before it touches the transcript or model.
  const screened = screenInboundMessage(input.message);

  if (screened.verdict === 'block') {
    conversation.turns.push({ role: 'user', content: '[message blocked by content filter]' });
    conversation.turns.push({ role: 'assistant', content: BLOCKED_REPLY });
    await store.saveConversation(conversation);
    return { text: BLOCKED_REPLY, toolCalls: [], blocked: true, truncated: false };
  }

  const userTurn: ConversationTurn = { role: 'user', content: screened.text };
  conversation.turns.push(userTurn);

  // 2. No model key → deterministic reply. The number still works.
  if (!config.agent.enabled) {
    const text = fallbackReply(config.webAppUrl, config.whatsapp.businessNumber);
    conversation.turns.push({ role: 'assistant', content: text });
    await store.saveConversation(conversation);
    return { text, toolCalls: [], blocked: false, truncated: false };
  }

  const systemPrompt = buildSystemPrompt({
    channel: input.channel,
    today: new Date().toISOString().slice(0, 10),
  });

  const tools = describeTools(input.principal);
  const messages = toChatMessages(conversation, systemPrompt);

  const toolCallsMade: string[] = [];
  let truncated = false;

  // 3. Bounded tool loop.
  for (let step = 0; step <= config.security.maxToolCallsPerTurn; step += 1) {
    if (step === config.security.maxToolCallsPerTurn) {
      truncated = true;
      messages.push({
        role: 'system',
        content:
          'Tool budget for this turn is exhausted. Reply to the customer now using only what you already have. ' +
          'Do not state any total you have not already been given.',
      });
    }

    let assistantMessage: ChatMessage;
    try {
      assistantMessage = await callModel(messages, tools);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[agent] model call failed', error);
      const text =
        'Sorry — I had trouble on my end just now. Could you send that again? ' +
        `If it keeps happening you can order here: ${config.webAppUrl}`;
      conversation.turns.push({ role: 'assistant', content: text });
      await store.saveConversation(conversation);
      return { text, toolCalls: toolCallsMade, blocked: false, truncated: false };
    }

    const requestedCalls = assistantMessage.tool_calls ?? [];

    if (requestedCalls.length === 0) {
      const text = screenOutboundMessage(assistantMessage.content ?? '');
      const finalText =
        text ||
        `Tell me your event date and guest count and I'll put a tray plan together. Full menu: ${config.webAppUrl}`;

      conversation.turns.push({ role: 'assistant', content: finalText });
      await store.saveConversation(conversation);
      return { text: finalText, toolCalls: toolCallsMade, blocked: false, truncated };
    }

    // Record the assistant's tool-call message so the API sees a valid sequence.
    messages.push({
      role: 'assistant',
      content: assistantMessage.content ?? null,
      tool_calls: requestedCalls,
    });

    for (const call of requestedCalls) {
      let parsedArguments: unknown = {};
      try {
        parsedArguments = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ ok: false, error: 'Arguments were not valid JSON. Send a JSON object.' }),
        });
        continue;
      }

      const result = await callTool(call.function.name, parsedArguments, input.principal);
      toolCallsMade.push(call.function.name);

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error }),
      });

      conversation.turns.push({
        role: 'tool',
        toolName: call.function.name,
        content: JSON.stringify(result.ok ? result.data : result.error).slice(0, 1200),
      });

      // Remember the cart so a customer can leave and come back mid-order.
      if (call.function.name === 'quote_order' && result.ok) {
        const args = parsedArguments as { items?: Conversation['cart'] };
        if (Array.isArray(args.items)) conversation.cart = args.items;
      }
    }
  }

  // Unreachable in practice — the budget branch above always returns.
  const fallback = `Let's pick this up — what's your event date and guest count? Menu: ${config.webAppUrl}`;
  conversation.turns.push({ role: 'assistant', content: fallback });
  await store.saveConversation(conversation);
  return { text: fallback, toolCalls: toolCallsMade, blocked: false, truncated: true };
}
