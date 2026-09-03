import { useState } from 'react';
import type { EventDetails } from '../types';

interface Props {
  initial: EventDetails;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (details: EventDetails) => void;
}

type Errors = Partial<Record<keyof EventDetails, string>>;

function validate(details: EventDetails): Errors {
  const errors: Errors = {};
  if (details.name.trim().length < 2) errors.name = 'Please enter the name for the order.';
  if (details.phone.replace(/\D/g, '').length < 10)
    errors.phone = 'Enter a 10-digit phone number we can reach you on.';
  if (!details.date) errors.date = 'Pick the date of your event.';
  const guests = Number(details.guestCount);
  if (!Number.isFinite(guests) || guests < 1) errors.guestCount = 'How many guests are you feeding?';
  if (details.address.trim().length < 8) errors.address = 'Enter the full delivery address.';
  return errors;
}

export default function DetailsForm({ initial, submitting, onBack, onSubmit }: Props) {
  const [details, setDetails] = useState<EventDetails>(initial);
  const [errors, setErrors] = useState<Errors>({});

  const update = (key: keyof EventDetails) => (value: string) =>
    setDetails((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate(details);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(details);
  };

  const errorText = (key: keyof EventDetails) =>
    errors[key] ? (
      <p id={`${key}-error`} className="mt-1.5 text-xs font-semibold text-saffron-700 dark:text-saffron-300">
        {errors[key]}
      </p>
    ) : null;

  const aria = (key: keyof EventDetails) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
  });

  return (
    <section aria-labelledby="details-heading" className="flex flex-col gap-6">
      <div>
        <p className="eyebrow">Step 2 of 4</p>
        <h2 id="details-heading" className="mt-2 text-3xl font-bold leading-[1.15]">
          Event details
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600 dark:text-cream-300">
          Tell us where the trays are going and when. We confirm every order by phone before cooking.
        </p>
      </div>

      <form className="surface flex flex-col gap-5 p-5 sm:p-6" onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              name="name"
              className="field"
              autoComplete="name"
              value={details.name}
              onChange={(event) => update('name')(event.target.value)}
              {...aria('name')}
            />
            {errorText('name')}
          </div>
          <div>
            <label className="field-label" htmlFor="phone">
              Mobile number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              className="field"
              autoComplete="tel"
              placeholder="(555) 123-4567"
              value={details.phone}
              onChange={(event) => update('phone')(event.target.value)}
              {...aria('phone')}
            />
            {errorText('phone')}
          </div>
          <div>
            <label className="field-label" htmlFor="date">
              Event date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              className="field"
              value={details.date}
              onChange={(event) => update('date')(event.target.value)}
              {...aria('date')}
            />
            {errorText('date')}
          </div>
          <div>
            <label className="field-label" htmlFor="guestCount">
              Guest count
            </label>
            <input
              id="guestCount"
              name="guestCount"
              type="number"
              inputMode="numeric"
              min={1}
              className="field tabular"
              value={details.guestCount}
              onChange={(event) => update('guestCount')(event.target.value)}
              {...aria('guestCount')}
            />
            {errorText('guestCount')}
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="address">
            Delivery address
          </label>
          <input
            id="address"
            name="address"
            className="field"
            autoComplete="street-address"
            value={details.address}
            onChange={(event) => update('address')(event.target.value)}
            {...aria('address')}
          />
          {errorText('address')}
        </div>

        <div>
          <label className="field-label" htmlFor="notes">
            Notes for the kitchen <span className="font-normal normal-case">(optional)</span>
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="field"
            placeholder="Spice level, serving time, allergies, parking instructions…"
            value={details.notes}
            onChange={(event) => update('notes')(event.target.value)}
          />
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button type="button" className="btn-secondary sm:w-auto" onClick={onBack}>
            Back to menu
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? 'Checking totals…' : 'Review order'}
          </button>
        </div>
      </form>
    </section>
  );
}
