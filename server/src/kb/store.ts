/**
 * BM25 knowledge base.
 *
 * Why BM25 and not embeddings: the corpus is small (dozens of documents about
 * one restaurant's menu, logistics and policies), it must answer instantly, and
 * it has to run with no external API key or vector database. BM25 with a
 * food-domain synonym layer handles "is the biryani spicy" and "how much notice
 * do you need" well, and it is fully inspectable — when the agent cites a
 * passage, you can see exactly why it matched.
 *
 * Retrieved text is untrusted: it is fenced by the guardrail layer before it
 * ever enters a prompt.
 */

import type { KbDocument, KbHit } from '../types.js';

// BM25 tuning. k1 controls term-frequency saturation, b controls length
// normalisation. These are the standard defaults and behave well on short docs.
const K1 = 1.5;
const B = 0.75;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from', 'get',
  'had', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'too',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you',
  'your', 'am', 'been', 'being', 'about',
]);

/**
 * Food-domain synonyms. Customers and menus rarely use the same words:
 * "mutton" and "goat" are the same protein here, "tray" and "pan" the same unit,
 * "spicy" and "hot" the same question. Expanding both the document and the query
 * through this table is what makes a small BM25 index feel smart.
 */
const SYNONYMS: Record<string, string[]> = {
  mutton: ['goat', 'lamb'],
  goat: ['mutton', 'lamb'],
  lamb: ['mutton', 'goat'],
  chicken: ['murgh', 'poultry'],
  murgh: ['chicken'],
  biryani: ['biriyani', 'briyani', 'rice', 'dum'],
  biriyani: ['biryani'],
  mandi: ['madni', 'arabian', 'roast'],
  paya: ['trotters', 'nihari'],
  marag: ['shorba', 'soup', 'broth'],
  spicy: ['hot', 'heat', 'chilli', 'chili', 'mirchi', 'masala'],
  hot: ['spicy', 'heat', 'chilli'],
  mild: ['gentle', 'kids', 'children', 'nonspicy'],
  veg: ['vegetarian', 'veggie'],
  vegetarian: ['veg', 'veggie', 'meatless'],
  vegan: ['plantbased', 'dairyfree'],
  halal: ['zabiha'],
  allergy: ['allergen', 'allergic', 'intolerance'],
  allergen: ['allergy', 'allergic'],
  nut: ['nuts', 'almond', 'cashew', 'treenut'],
  dairy: ['milk', 'cream', 'yoghurt', 'yogurt', 'ghee', 'paneer'],
  gluten: ['wheat', 'flour'],
  tray: ['pan', 'platter', 'catering'],
  full: ['large', 'big'],
  half: ['small', 'medium'],
  serves: ['feeds', 'people', 'guests', 'headcount', 'portion', 'portions'],
  guests: ['people', 'serves', 'feeds', 'headcount'],
  price: ['cost', 'pricing', 'rate', 'how much', 'charge'],
  cost: ['price', 'pricing', 'charge'],
  delivery: ['deliver', 'dropoff', 'shipping', 'transport'],
  pickup: ['collect', 'takeaway', 'carryout'],
  order: ['ordering', 'book', 'booking', 'reserve'],
  notice: ['advance', 'leadtime', 'ahead', 'early'],
  cancel: ['cancellation', 'refund', 'reschedule'],
  pay: ['payment', 'zelle', 'deposit', 'paying'],
  zelle: ['pay', 'payment', 'transfer'],
  dessert: ['sweet', 'pudding', 'cake', 'mithai'],
  sweet: ['dessert', 'mithai'],
  mango: ['alphonso'],
  starter: ['appetizer', 'appetiser', 'snack', 'fry'],
  reheat: ['warm', 'reheating', 'oven'],
  leftover: ['leftovers', 'store', 'storage', 'fridge'],
};

function tokenise(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

/** Very light suffix stemmer — enough for plurals and -ing/-ed forms. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  for (const suffix of ['iness', 'ingly', 'ing', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 's']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

function expand(tokens: string[]): string[] {
  const output = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SYNONYMS[token] ?? []) {
      for (const piece of tokenise(synonym)) output.add(piece);
    }
  }
  return [...output];
}

interface IndexedDoc {
  doc: KbDocument;
  /** Term → frequency within this document. */
  frequencies: Map<string, number>;
  length: number;
}

export class KnowledgeBase {
  private docs: IndexedDoc[] = [];
  private documentFrequency = new Map<string, number>();
  private averageLength = 0;

  add(documents: KbDocument[]): void {
    for (const doc of documents) {
      // Title is weighted by repeating it — a cheap, predictable field boost.
      const tokens = expand(tokenise(`${doc.title} ${doc.title} ${doc.tags.join(' ')} ${doc.body}`));
      const frequencies = new Map<string, number>();
      for (const token of tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      this.docs.push({ doc, frequencies, length: tokens.length });
    }
    this.reindex();
  }

  replaceBySource(source: string, documents: KbDocument[]): void {
    this.docs = this.docs.filter((entry) => entry.doc.source !== source);
    this.add(documents);
  }

  private reindex(): void {
    this.documentFrequency = new Map();
    let totalLength = 0;

    for (const entry of this.docs) {
      totalLength += entry.length;
      for (const term of entry.frequencies.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }

    this.averageLength = this.docs.length > 0 ? totalLength / this.docs.length : 0;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.documentFrequency.get(term) ?? 0;
    // Standard BM25 IDF with +1 smoothing so it never goes negative.
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, options: { limit?: number; itemId?: string; minScore?: number } = {}): KbHit[] {
    const { limit = 4, itemId, minScore = 0.15 } = options;
    const queryTerms = expand(tokenise(query));
    if (queryTerms.length === 0 || this.docs.length === 0) return [];

    const scored = this.docs
      .filter((entry) => !itemId || entry.doc.itemId === itemId)
      .map((entry) => {
        let score = 0;
        for (const term of queryTerms) {
          const frequency = entry.frequencies.get(term);
          if (!frequency) continue;
          const numerator = frequency * (K1 + 1);
          const denominator =
            frequency + K1 * (1 - B + B * (entry.length / (this.averageLength || 1)));
          score += this.idf(term) * (numerator / denominator);
        }
        return { entry, score };
      })
      .filter((result) => result.score > 0);

    if (scored.length === 0) return [];

    // Normalise against the best hit so `minScore` is a relative threshold and
    // stays meaningful as the corpus grows.
    const best = Math.max(...scored.map((result) => result.score));

    return scored
      .map((result) => ({ ...result, normalised: result.score / best }))
      .filter((result) => result.normalised >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 10)))
      .map((result) => ({
        doc: result.entry.doc,
        score: Number(result.normalised.toFixed(4)),
        snippet: snippetFor(result.entry.doc.body, queryTerms),
      }));
  }

  get size(): number {
    return this.docs.length;
  }

  sources(): string[] {
    return [...new Set(this.docs.map((entry) => entry.doc.source))];
  }
}

/** Pull the most relevant ~240 characters out of a document body. */
function snippetFor(body: string, queryTerms: string[]): string {
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) return body.slice(0, 240);

  const terms = new Set(queryTerms);
  let bestSentence = sentences[0]!;
  let bestOverlap = -1;

  for (const sentence of sentences) {
    const tokens = new Set(tokenise(sentence));
    let overlap = 0;
    for (const token of tokens) if (terms.has(token)) overlap += 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSentence = sentence;
    }
  }

  return bestSentence.length > 300 ? `${bestSentence.slice(0, 297)}…` : bestSentence;
}

/** Process-wide knowledge base. */
export const knowledgeBase = new KnowledgeBase();
