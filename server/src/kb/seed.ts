/**
 * Baseline knowledge-base content.
 *
 * Two parts:
 *   1. Per-item documents generated from menu.json, so every dish is answerable
 *      without duplicating price data (prices always come from the menu module).
 *   2. Hand-written operating policy documents — lead time, delivery, reheating,
 *      allergens, payment. These are `isTrusted: true` because we authored them.
 *
 * Edit the policy text here to change what the agent tells customers.
 */

import { getMenu, listItems, servingsFor } from '../domain/menu.js';
import type { KbDocument } from '../types.js';

function itemDocuments(): KbDocument[] {
  const menu = getMenu();
  const categoryNames = new Map(menu.categories.map((category) => [category.id, category.name]));

  return listItems().map((item) => {
    const full = servingsFor('full');
    const half = servingsFor('half');

    const spiceWords = ['not spicy at all', 'very mild', 'mild', 'medium heat', 'quite spicy', 'very spicy'];
    const sizeSentence =
      item.prices.half === null
        ? `${item.name} comes as a full tray only, which serves about ${full.min} to ${full.max} guests.`
        : `${item.name} comes as a full tray (serves about ${full.min}-${full.max}) or a half tray (serves about ${half.min}-${half.max}).`;

    const allergenSentence =
      item.allergens.length > 0
        ? `It contains ${item.allergens.join(', ')}. Tell us about allergies when you order and we will flag what is safe.`
        : `It has no dairy, gluten, nut or egg ingredients in our standard preparation.`;

    const pairingNames = item.pairings
      .map((id) => listItems().find((candidate) => candidate.id === id)?.name)
      .filter((name): name is string => Boolean(name));

    const body = [
      item.description,
      sizeSentence,
      `Spice level is ${item.spice} out of 5 — ${spiceWords[item.spice] ?? 'medium heat'}.`,
      `Main protein: ${item.protein}. Category: ${categoryNames.get(item.category) ?? item.category}.`,
      allergenSentence,
      item.dietary.length > 0 ? `Dietary notes: ${item.dietary.join(', ')}.` : '',
      pairingNames.length > 0 ? `Guests usually order it alongside ${pairingNames.join(' or ')}.` : '',
      item.popular ? 'This is one of our most-ordered trays.' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      id: `item:${item.id}`,
      title: item.name,
      body,
      source: 'menu',
      tags: ['menu', item.category, item.protein, ...item.dietary],
      itemId: item.id,
    };
  });
}

const POLICY_DOCUMENTS: KbDocument[] = [
  {
    id: 'policy:lead-time',
    title: 'How much notice do you need for a catering order?',
    body:
      'We ask for at least 48 hours notice on any catering order, and 5 to 7 days for events over 100 guests or on a weekend. ' +
      'Biryani and mandi are cooked to order on the morning of your event, so the date has to be locked before we buy ingredients. ' +
      'If your event is sooner than 48 hours, message us anyway — we can sometimes fit a small order in, but we cannot promise it.',
    source: 'policy',
    tags: ['ordering', 'notice', 'lead time', 'booking'],
  },
  {
    id: 'policy:how-to-order',
    title: 'How to place an order',
    body:
      'You can order two ways. Chat with us on WhatsApp and we will build the tray plan with you, or use the online ordering page ' +
      'to tap trays into a cart yourself. Either way you tell us the event date, guest count, delivery address and any allergies, ' +
      'and we send back an itemised quote with the exact total before you pay anything.',
    source: 'policy',
    tags: ['ordering', 'whatsapp', 'website', 'how'],
  },
  {
    id: 'policy:payment-zelle',
    title: 'How payment works — Zelle',
    body:
      'We take payment by Zelle. When your order is confirmed you get a five-character memo code that looks like SS-4K7QP. ' +
      'Send the amount by Zelle and put that memo code in the memo or note field — that is how we match your payment to your order. ' +
      'Then tap "I have paid" or reply PAID on WhatsApp, and attach a screenshot if you have one. ' +
      'A member of our team checks the deposit against the memo code and confirms your order. ' +
      'Your order is not locked in until we have confirmed the payment, so do not assume a date is held before you hear back from us.',
    source: 'policy',
    tags: ['payment', 'zelle', 'deposit', 'memo', 'pay'],
  },
  {
    id: 'policy:deposit',
    title: 'Do I have to pay the whole amount up front?',
    body:
      'For most events we take a deposit to lock the date and the balance on delivery. The exact deposit amount is shown on your ' +
      'quote, so you never have to work it out yourself. Small orders are usually paid in full up front because it is simpler for everyone. ' +
      'We do not take card payments or cash on delivery for the deposit.',
    source: 'policy',
    tags: ['payment', 'deposit', 'balance', 'cost'],
  },
  {
    id: 'policy:delivery',
    title: 'Delivery and pickup',
    body:
      'We deliver across San Jose and the wider South Bay. Delivery is free on larger orders and the fee, if any, is shown on your quote ' +
      'before you pay. We arrive in a 30-minute window that we agree with you, and trays come in insulated carriers that hold temperature ' +
      'for roughly two hours. Pickup from our kitchen is available if you prefer — say so when you order and we will give you a time slot. ' +
      'We do not provide serving staff, chafing dishes or setup unless you ask us in advance.',
    source: 'policy',
    tags: ['delivery', 'pickup', 'san jose', 'south bay', 'setup'],
  },
  {
    id: 'policy:how-much-food',
    title: 'How many trays do I need for my guest count?',
    body:
      'A full tray feeds roughly 18 to 22 people as a main dish, and a half tray feeds 9 to 11. ' +
      'The usual rule for a mixed menu is one full tray of biryani or mandi for every 20 guests, plus one curry tray and one starter tray ' +
      'for every 25 guests. If a dish is the only main, size it for the full headcount. Tell us your guest count and we will check the plan ' +
      'against it and warn you if it is short.',
    source: 'policy',
    tags: ['guests', 'serves', 'portions', 'how many', 'quantity'],
  },
  {
    id: 'policy:allergens',
    title: 'Allergies and dietary requirements',
    body:
      'All our meat is halal. Most of our curries and biryanis contain dairy, and several contain tree nuts such as almond and cashew ' +
      'because they are ground into the gravy. Mandi dishes are our best options for dairy-free guests. ' +
      'Our kitchen handles dairy, gluten, nuts and eggs, so we cannot guarantee a dish is free from traces of them. ' +
      'If someone has a severe allergy, tell us before you order and we will be straight with you about what is genuinely safe.',
    source: 'policy',
    tags: ['allergy', 'allergen', 'halal', 'dairy', 'nuts', 'gluten', 'vegetarian'],
  },
  {
    id: 'policy:spice',
    title: 'How spicy is the food, and can you make it milder?',
    body:
      'Every dish carries a spice rating from 0 to 5 on the menu. Red Chicken is our hottest at 5 out of 5, and the mandi dishes are the ' +
      'mildest savoury option at 2 out of 5, which most children will eat. We can dial the heat down on curries if you ask when you order. ' +
      'We cannot make biryani mild, because the spice is built into the layers during cooking.',
    source: 'policy',
    tags: ['spicy', 'hot', 'mild', 'kids', 'children', 'heat'],
  },
  {
    id: 'policy:reheat-and-leftovers',
    title: 'Reheating and leftovers',
    body:
      'Trays arrive hot and ready to serve. To hold them, keep them covered in an oven at 200F. To reheat biryani, sprinkle a little water ' +
      'over the rice, cover with foil and warm at 325F for 20 to 25 minutes so it steams rather than dries out. Curries reheat best on the ' +
      'stovetop over a low flame. Refrigerate leftovers within two hours and eat them within three days. Do not refreeze a tray that arrived hot.',
    source: 'policy',
    tags: ['reheat', 'leftovers', 'storage', 'oven', 'fridge'],
  },
  {
    id: 'policy:changes-and-cancellations',
    title: 'Changing or cancelling an order',
    body:
      'You can change your tray selection or guest count free of charge up to 72 hours before your event, and we will requote it. ' +
      'Inside 72 hours we can usually add trays but not remove them, because the shopping is already done. ' +
      'Cancellations more than 72 hours out are refunded in full. Inside 72 hours the deposit is not refundable. ' +
      'To change anything, message us on WhatsApp with your memo code.',
    source: 'policy',
    tags: ['cancel', 'change', 'refund', 'reschedule', 'amend'],
  },
  {
    id: 'policy:contact-and-hours',
    title: 'Contact and kitchen hours',
    body:
      'The fastest way to reach us is WhatsApp — a real person reads every chat, and the ordering agent handles quotes instantly at any hour. ' +
      'Our kitchen cooks Tuesday through Sunday. We are closed on Mondays, so we cannot deliver on a Monday. ' +
      'We serve San Jose and the South Bay for weddings, corporate lunches, birthdays and religious functions.',
    source: 'policy',
    tags: ['contact', 'hours', 'closed', 'monday', 'whatsapp', 'events'],
  },
  {
    id: 'policy:agent-limits',
    title: 'What the ordering agent can and cannot do',
    body:
      'The ordering agent can search the menu, answer questions, build a quote, place an order and record that you have paid. ' +
      'It cannot change a price, apply a discount, or confirm that a payment has arrived — every total is calculated by our system and ' +
      'every payment is checked by a person. If you need a discount, a custom dish or anything unusual, ask and we will pass it to the owner.',
    source: 'policy',
    tags: ['agent', 'ai', 'limits', 'discount', 'price'],
  },
];

export function seedDocuments(): KbDocument[] {
  return [...itemDocuments(), ...POLICY_DOCUMENTS];
}
