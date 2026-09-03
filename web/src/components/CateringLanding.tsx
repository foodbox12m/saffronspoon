interface Props {
  selectionCount: number;
  onStartOrdering: () => void;
}

export default function CateringLanding({
  selectionCount,
  onStartOrdering,
}: Props) {
  return (
    <section aria-labelledby="catering-heading" className="flex flex-col gap-8">
      <div>
        <p className="eyebrow">Homemade Hyderabadi Food Catering</p>
        <h1 id="catering-heading" className="mt-4 text-4xl font-bold leading-[1.08] sm:text-5xl">
          Bring authentic Hyderabadi flavors to your event
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-600 dark:text-cream-300">
          From traditional biryanis to rich curries and exquisite desserts, we craft every dish with homemade love
          and premium ingredients. Perfect for parties, weddings, and corporate events.
        </p>
      </div>

      <button type="button" onClick={onStartOrdering} className="btn-primary w-fit">
        Start Your Catering Order
        {selectionCount > 0 && <span className="ml-2 font-bold">({selectionCount} selected)</span>}
      </button>
    </section>
  );
}
