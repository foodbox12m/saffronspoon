import { useState, useMemo } from 'react';
import type { Menu, CateringInquiry, CateringSelection } from '../types';
import { formatCents } from '../lib/money';

interface Props {
  menu: Menu;
  selections: Record<string, number>;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (inquiry: CateringInquiry) => void;
}

const GUEST_COUNT_OPTIONS = [
  { label: '6-10 guests', value: '6-10' },
  { label: '11-20 guests', value: '11-20' },
  { label: '21-30 guests', value: '21-30' },
  { label: '31-50 guests', value: '31-50' },
  { label: '51-75 guests', value: '51-75' },
  { label: '75+ guests', value: '75+' },
];

type Errors = Partial<Record<string, string>>;

export default function CateringInquiryForm({
  menu,
  selections,
  submitting,
  onBack,
  onSubmit,
}: Props) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    eventDate: '',
    guestCount: '21-30',
    specialRequests: '',
  });

  const [errors, setErrors] = useState<Errors>({});

  const selectedItems = useMemo(() => {
    return Object.entries(selections)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantity]) => ({
        itemId,
        quantity,
      }));
  }, [selections]);

  const estimatedTotal = useMemo(() => {
    return selectedItems.reduce((total, sel) => {
      const item = menu.items.find((i) => i.id === sel.itemId);
      if (!item) return total;
      return total + item.prices.full * sel.quantity;
    }, 0);
  }, [selectedItems, menu.items]);

  const validateForm = (): boolean => {
    const newErrors: Errors = {};

    if (formData.name.trim().length < 2) {
      newErrors.name = 'Please enter a valid name.';
    }
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email.';
    }
    if (formData.phone.replace(/\D/g, '').length < 10) {
      newErrors.phone = 'Enter a valid 10-digit phone number.';
    }
    if (!formData.eventDate) {
      newErrors.eventDate = 'Pick the date of your event.';
    }
    if (selectedItems.length === 0) {
      newErrors.items = 'Please select at least one item.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    onSubmit({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      eventDate: formData.eventDate,
      guestCount: formData.guestCount,
      selectedItems,
      specialRequests: formData.specialRequests,
    });
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`${field}-error`} className="mt-1.5 text-xs font-semibold text-saffron-700 dark:text-saffron-300">
        {errors[field]}
      </p>
    ) : null;

  const aria = (field: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${field}-error` : undefined,
  });

  return (
    <section aria-labelledby="catering-heading" className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">Catering Inquiry</p>
        <h2 id="catering-heading" className="mt-2 text-3xl font-bold leading-[1.15]">
          Event details
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          Tell us about your event and the dishes you'd like to order. We'll prepare everything fresh for you.
        </p>
      </div>

      <form className="surface flex flex-col gap-5 p-5 sm:p-6" onSubmit={handleSubmit} noValidate>
        {/* Selected Items Summary */}
        {selectedItems.length > 0 && (
          <div className="rounded-lg bg-saffron-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-saffron-700 dark:text-saffron-300 mb-3">
              Your Selection
            </p>
            <ul className="flex flex-col gap-1">
              {selectedItems.map((sel) => {
                const item = menu.items.find((i) => i.id === sel.itemId);
                if (!item) return null;
                const lineTotal = item.prices.full * sel.quantity;
                return (
                  <li key={sel.itemId} className="text-sm text-ink-700 dark:text-cream-200">
                    {sel.quantity} × {item.name} — 
                    <span className="ml-1 tabular font-semibold text-saffron-700 dark:text-saffron-300">
                      {formatCents(lineTotal, menu.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 border-t border-saffron-500/20 pt-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-900 dark:text-cream-100">
                Estimated Total
              </span>
              <span className="tabular font-display text-xl font-bold text-saffron-700 dark:text-saffron-300">
                {formatCents(estimatedTotal, menu.currency)}
              </span>
            </div>
          </div>
        )}

        {/* Form Fields */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="field"
              autoComplete="name"
              value={formData.name}
              onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              {...aria('name')}
            />
            {errorText('name')}
          </div>

          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              autoComplete="email"
              value={formData.email}
              onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
              {...aria('email')}
            />
            {errorText('email')}
          </div>

          <div>
            <label className="field-label" htmlFor="phone">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              className="field"
              autoComplete="tel"
              value={formData.phone}
              onChange={(event) => setFormData((prev) => ({ ...prev, phone: event.target.value }))}
              {...aria('phone')}
            />
            {errorText('phone')}
          </div>

          <div>
            <label className="field-label" htmlFor="eventDate">
              Event date
            </label>
            <input
              id="eventDate"
              type="date"
              className="field"
              value={formData.eventDate}
              onChange={(event) => setFormData((prev) => ({ ...prev, eventDate: event.target.value }))}
              {...aria('eventDate')}
            />
            {errorText('eventDate')}
          </div>

          <div>
            <label className="field-label" htmlFor="guestCount">
              Number of guests
            </label>
            <select
              id="guestCount"
              className="field"
              value={formData.guestCount}
              onChange={(event) => setFormData((prev) => ({ ...prev, guestCount: event.target.value }))}
            >
              {GUEST_COUNT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="specialRequests">
            Special requests or dietary requirements
          </label>
          <textarea
            id="specialRequests"
            className="field"
            rows={3}
            value={formData.specialRequests}
            onChange={(event) => setFormData((prev) => ({ ...prev, specialRequests: event.target.value }))}
            placeholder="Any allergies, preferences, or special preparations?"
          />
        </div>

        {errors.items && (
          <p id="items-error" className="mt-1.5 text-xs font-semibold text-saffron-700 dark:text-saffron-300">
            {errors.items}
          </p>
        )}

        {/* Action Buttons */}
        <div className="mt-4 flex gap-3 sm:justify-end">
          <button type="button" onClick={onBack} className="btn-secondary flex-1 sm:flex-none" disabled={submitting}>
            Back
          </button>
          <button
            type="submit"
            className="btn-primary flex-1 sm:flex-none"
            disabled={submitting || selectedItems.length === 0}
          >
            {submitting ? 'Submitting...' : 'Submit Inquiry'}
          </button>
        </div>
      </form>
    </section>
  );
}
