import { useState } from 'react';
import Notice from './Notice';
import { formatCents } from '../lib/money';
import { ZELLE_ID } from '../lib/env';

interface Props {
  totalCents: number;
  currency: string;
  memoCode: string;
  confirmed: boolean;
  orderId?: string;
  whatsappHref: string;
  claimState: 'idle' | 'sending' | 'done' | 'error';
  onClaimPaid: (note: string, fileName?: string) => void;
  onStartOver: () => void;
}

const qrSrc = `${import.meta.env.BASE_URL}zelle-qr.png`;

export default function ZelleScreen({
  totalCents,
  currency,
  memoCode,
  confirmed,
  orderId,
  whatsappHref,
  claimState,
  onClaimPaid,
  onStartOver,
}: Props) {
  const [fileName, setFileName] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="pay-heading" className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">Step 4 of 4</p>
        <h2 id="pay-heading" className="mt-2 text-3xl font-bold leading-[1.15]">
          Pay with Zelle
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          Send the exact amount below and include the memo code so we can match your payment to your
          order.
        </p>
      </div>

      {confirmed ? (
        <Notice>
          Order received{orderId ? ` (ref ${orderId})` : ''}. We will confirm by phone once payment
          lands.
        </Notice>
      ) : (
        <Notice tone="warn">
          We could not reach our ordering service, so this order is <strong>not confirmed yet</strong>{' '}
          and the memo code below is a temporary placeholder.{' '}
          <a
            className="font-semibold underline decoration-dotted"
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Send your order on WhatsApp
          </a>{' '}
          so we can lock it in.
        </Notice>
      )}

      <div className="surface flex flex-col gap-6 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <dl className="flex min-w-0 flex-col gap-4 text-sm">
            <div>
              <dt className="field-label">Amount to send</dt>
              <dd className="tabular font-display text-3xl font-bold text-saffron-700 dark:text-saffron-300">
                {formatCents(totalCents, currency)}
              </dd>
            </div>
            <div>
              <dt className="field-label">Zelle recipient</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="break-all font-semibold">{ZELLE_ID}</span>
                <button type="button" className="btn-secondary min-h-[36px] px-3 text-xs" onClick={() => copy(ZELLE_ID)}>
                  Copy
                </button>
              </dd>
            </div>
            <div>
              <dt className="field-label">Payment memo (required)</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="tabular rounded-lg border border-dashed border-saffron-600/60 px-3 py-1.5 font-mono text-base font-bold">
                  {memoCode}
                </span>
                <button type="button" className="btn-secondary min-h-[36px] px-3 text-xs" onClick={() => copy(memoCode)}>
                  Copy
                </button>
              </dd>
            </div>
            <p aria-live="polite" className="min-h-[1rem] text-xs text-ink-600 dark:text-cream-300">
              {copied ? 'Copied to clipboard.' : ''}
            </p>
          </dl>

          <figure className="mx-auto flex w-full max-w-[15rem] flex-col items-center gap-2 sm:mx-0">
            <img
              src={qrSrc}
              width={240}
              height={240}
              alt="Zelle QR code for saffron & spoon payments"
              className="w-full rounded-xl bg-white p-3"
            />
            <figcaption className="text-xs text-ink-600 dark:text-cream-300">
              Scan in your banking app
            </figcaption>
          </figure>
        </div>

        <div className="border-t border-cream-200 pt-5 dark:border-ink-700">
          <label className="field-label" htmlFor="proof">
            Payment screenshot <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="proof"
            type="file"
            accept="image/*"
            className="field py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-saffron-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-ink-950"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
          />
          <p className="mt-1.5 text-xs text-ink-600 dark:text-cream-300">
            {fileName
              ? `Attached: ${fileName}. We will ask you to send it on WhatsApp if we need it.`
              : 'Speeds up confirmation, but is never required.'}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={claimState === 'sending' || claimState === 'done'}
            onClick={() => onClaimPaid(memoCode, fileName || undefined)}
          >
            {claimState === 'sending'
              ? 'Letting the kitchen know…'
              : claimState === 'done'
                ? 'Payment reported — thank you'
                : "I've sent the payment"}
          </button>
          {claimState === 'error' ? (
            <Notice tone="warn">
              We could not record your payment automatically.{' '}
              <a
                className="font-semibold underline decoration-dotted"
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Message us on WhatsApp
              </a>{' '}
              with memo {memoCode} and we will confirm manually.
            </Notice>
          ) : null}
          {claimState === 'done' ? (
            <p className="text-sm text-ink-600 dark:text-cream-300">
              We will text {`${memoCode}`} confirmation to your number shortly.
            </p>
          ) : null}
          <button type="button" className="btn-secondary w-full" onClick={onStartOver}>
            Start a new order
          </button>
        </div>
      </div>
    </section>
  );
}
