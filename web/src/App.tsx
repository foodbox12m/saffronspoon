import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import Notice from './components/Notice';
import MenuBrowser from './components/MenuBrowser';
import CartDrawer from './components/CartDrawer';
import StickyCartBar from './components/StickyCartBar';
import DetailsForm from './components/DetailsForm';
import ReviewStep from './components/ReviewStep';
import ZelleScreen from './components/ZelleScreen';
import { useCart } from './hooks/useCart';
import { useTheme } from './hooks/useTheme';
import { claimPayment, createOrder, fetchMenu, fetchQuote } from './lib/api';
import { localMenu, previewQuote } from './lib/menu';
import { localMemoCode } from './lib/memo';
import { buildOrderMessage, whatsappLink } from './lib/whatsapp';
import { HAS_API } from './lib/env';
import type { EventDetails, Menu, Quote } from './types';

type Step = 'menu' | 'details' | 'review' | 'pay';

const emptyDetails: EventDetails = {
  name: '',
  phone: '',
  date: '',
  guestCount: '',
  address: '',
  notes: '',
};

export default function App() {
  const { theme, toggle } = useTheme();
  const cart = useCart();
  const [menu, setMenu] = useState<Menu>(localMenu);
  const [step, setStep] = useState<Step>('menu');
  const [cartOpen, setCartOpen] = useState(false);
  const [details, setDetails] = useState<EventDetails>(emptyDetails);
  const [serverQuote, setServerQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string>(
    HAS_API ? '' : 'Live ordering is not switched on for this build — you can still build your order and send it to us on WhatsApp in one tap.',
  );
  const [orderId, setOrderId] = useState<string>('');
  const [memoCode, setMemoCode] = useState<string>('');
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [claimState, setClaimState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  // Refresh the menu from the API when available; the bundled copy renders instantly.
  useEffect(() => {
    if (!HAS_API) return;
    let cancelled = false;
    fetchMenu()
      .then((remote) => {
        if (!cancelled && Array.isArray(remote?.items) && remote.items.length > 0) setMenu(remote);
      })
      .catch(() => {
        if (!cancelled)
          setOfflineNotice(
            'We could not load live pricing, so you are seeing our last published menu. You can still place your order — we will confirm it with you directly.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const localPreview = useMemo(() => previewQuote(menu, cart.cart), [menu, cart.cart]);
  const quote = serverQuote ?? localPreview;
  const quoteAuthoritative = serverQuote !== null;

  // Any cart change invalidates a previously fetched server quote.
  useEffect(() => {
    setServerQuote(null);
  }, [cart.cart]);

  const whatsappHref = useMemo(
    () => whatsappLink(buildOrderMessage(menu, cart.cart, quote, details, memoCode || undefined)),
    [menu, cart.cart, quote, details, memoCode],
  );

  const goToDetails = useCallback(() => {
    setCartOpen(false);
    setStep('details');
    window.scrollTo({ top: 0 });
  }, []);

  const submitDetails = useCallback(
    async (next: EventDetails) => {
      setDetails(next);
      setBusy(true);
      try {
        const authoritative = await fetchQuote(cart.cart);
        setServerQuote(authoritative);
        setOfflineNotice('');
      } catch {
        setServerQuote(null);
        setOfflineNotice(
          'We could not confirm the total with our kitchen just now, so the figure below is our own estimate. We will confirm the final amount with you before you pay.',
        );
      } finally {
        setBusy(false);
        setStep('review');
        window.scrollTo({ top: 0 });
      }
    },
    [cart.cart],
  );

  const confirmOrder = useCallback(async () => {
    setBusy(true);
    try {
      const order = await createOrder(details, cart.cart);
      setOrderId(order.orderId);
      setMemoCode(order.memoCode);
      setServerQuote((prev) =>
        prev ? { ...prev, totalCents: order.totalCents } : { ...localPreview, totalCents: order.totalCents },
      );
      setOrderConfirmed(true);
      setOfflineNotice('');
    } catch {
      setOrderId('');
      setMemoCode(localMemoCode());
      setOrderConfirmed(false);
    } finally {
      setBusy(false);
      setStep('pay');
      window.scrollTo({ top: 0 });
    }
  }, [details, cart.cart, localPreview]);

  const reportPaid = useCallback(
    async (note: string, fileName?: string) => {
      if (!orderConfirmed || !orderId) {
        setClaimState('error');
        return;
      }
      setClaimState('sending');
      try {
        await claimPayment(orderId, {
          note: fileName ? `${note} · screenshot: ${fileName}` : note,
        });
        setClaimState('done');
      } catch {
        setClaimState('error');
      }
    },
    [orderConfirmed, orderId],
  );

  const startOver = useCallback(() => {
    cart.clear();
    setDetails(emptyDetails);
    setServerQuote(null);
    setOrderId('');
    setMemoCode('');
    setOrderConfirmed(false);
    setClaimState('idle');
    setStep('menu');
    window.scrollTo({ top: 0 });
  }, [cart]);

  return (
    <div className="min-h-screen pb-24 lg:pb-0">
      <Header
        theme={theme}
        onToggleTheme={toggle}
        cartCount={cart.count}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        {step === 'menu' ? (
          <>
            <section className="flex flex-col gap-4">
              <p className="eyebrow">Catering by the tray</p>
              <h1 className="max-w-2xl text-[2.1rem] font-bold leading-[1.08] sm:text-5xl">
                Hyderabadi feasts, delivered by the tray.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-ink-600 dark:text-cream-300">
                Pick your dishes, choose full or half trays, and pay by Zelle. Full trays serve
                18&ndash;22 guests; half trays serve 9&ndash;11.
              </p>
            </section>
            {offlineNotice ? <Notice tone="warn">{offlineNotice}</Notice> : null}
            <MenuBrowser menu={menu} onAdd={cart.add} />
            <div className="hidden lg:flex">
              <button
                type="button"
                className="btn-primary"
                disabled={cart.count === 0}
                onClick={() => setCartOpen(true)}
              >
                Review {cart.count} {cart.count === 1 ? 'tray' : 'trays'}
              </button>
            </div>
          </>
        ) : null}

        {step === 'details' ? (
          <DetailsForm
            initial={details}
            submitting={busy}
            onBack={() => setStep('menu')}
            onSubmit={submitDetails}
          />
        ) : null}

        {step === 'review' ? (
          <ReviewStep
            menu={menu}
            cart={cart.cart}
            quote={quote}
            quoteAuthoritative={quoteAuthoritative}
            details={details}
            submitting={busy}
            notice={offlineNotice || undefined}
            whatsappHref={whatsappHref}
            onBack={() => setStep('details')}
            onConfirm={confirmOrder}
          />
        ) : null}

        {step === 'pay' ? (
          <ZelleScreen
            totalCents={quote.totalCents}
            currency={menu.currency}
            memoCode={memoCode}
            confirmed={orderConfirmed}
            orderId={orderId || undefined}
            whatsappHref={whatsappHref}
            claimState={claimState}
            onClaimPaid={reportPaid}
            onStartOver={startOver}
          />
        ) : null}
      </main>

      <footer className="border-t border-cream-200 px-4 py-8 text-xs text-ink-600 dark:border-ink-700 dark:text-cream-300 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            saffron <i className="not-italic text-saffron-600 dark:text-saffron-400">&amp;</i> spoon
            &middot; Hyderabadi soul, generous portions.
          </span>
          <a className="underline decoration-dotted" href={whatsappHref} target="_blank" rel="noopener noreferrer">
            Questions? Message us on WhatsApp
          </a>
        </div>
      </footer>

      {step === 'menu' ? (
        <>
          <StickyCartBar
            count={cart.count}
            totalCents={quote.totalCents}
            currency={menu.currency}
            onOpen={() => setCartOpen(true)}
          />
          <CartDrawer
            open={cartOpen}
            onClose={() => setCartOpen(false)}
            menu={menu}
            cart={cart}
            quote={quote}
            quoteAuthoritative={quoteAuthoritative}
            onCheckout={goToDetails}
          />
        </>
      ) : null}
    </div>
  );
}
