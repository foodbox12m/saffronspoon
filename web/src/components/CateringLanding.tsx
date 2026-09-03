interface Props {
  selectionCount: number;
  onStartOrdering: () => void;
  onNavigateToMenu?: () => void;
}

export default function CateringLanding({
  selectionCount,
  onStartOrdering,
  onNavigateToMenu,
}: Props) {
  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      {/* Hero Section */}
      <section aria-labelledby="catering-heading" className="flex flex-col gap-6">
        <div>
          <p className="eyebrow">Homemade Hyderabadi Food Catering</p>
          <h1 id="catering-heading" className="mt-4 text-4xl font-bold leading-[1.08] sm:text-5xl lg:text-6xl">
            Bring authentic Hyderabadi feasts to your special event.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600 dark:text-cream-300 sm:text-lg">
            From slow-cooked Zafrani Dum Biryanis and rich wedding-style curries to artisanal desserts like Mango Trifle and Coconut Dal Puri, every dish is crafted with homemade devotion and time-honored heritage spices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onStartOrdering} className="btn-primary">
            {selectionCount > 0 ? `Continue Catering Order (${selectionCount} dishes)` : 'Build Catering Order'}
          </button>
          {onNavigateToMenu && (
            <button type="button" onClick={onNavigateToMenu} className="btn-secondary">
              Order by Tray Instead
            </button>
          )}
        </div>
      </section>

      {/* Feature Highlights */}
      <section aria-label="Catering Highlights" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface flex flex-col gap-2.5 p-5">
          <div className="text-2xl" aria-hidden="true">🍲</div>
          <h3 className="font-bold text-base text-ink-950 dark:text-cream-50">Heritage Old City Flavors</h3>
          <p className="text-xs leading-relaxed text-ink-600 dark:text-cream-300">
            Slow dum cooking sealed with dough, saffron-scented long basmati, and royal Nizam-era gravies.
          </p>
        </div>

        <div className="surface flex flex-col gap-2.5 p-5">
          <div className="text-2xl" aria-hidden="true">👥</div>
          <h3 className="font-bold text-base text-ink-950 dark:text-cream-50">Any Event Size</h3>
          <p className="text-xs leading-relaxed text-ink-600 dark:text-cream-300">
            Catering packages tailored from intimate gatherings of 6 guests to celebratory banquets of 75+.
          </p>
        </div>

        <div className="surface flex flex-col gap-2.5 p-5">
          <div className="text-2xl" aria-hidden="true">🌿</div>
          <h3 className="font-bold text-base text-ink-950 dark:text-cream-50">100% Halal &amp; Fresh</h3>
          <p className="text-xs leading-relaxed text-ink-600 dark:text-cream-300">
            Cooked fresh strictly for your date. Certified halal meats, pure ghee, and fresh whole spices.
          </p>
        </div>

        <div className="surface flex flex-col gap-2.5 p-5">
          <div className="text-2xl" aria-hidden="true">💬</div>
          <h3 className="font-bold text-base text-ink-950 dark:text-cream-50">WhatsApp Confirmation</h3>
          <p className="text-xs leading-relaxed text-ink-600 dark:text-cream-300">
            Direct coordination with our team on WhatsApp for quick menu planning and custom requirements.
          </p>
        </div>
      </section>

      {/* 3-Step Process Overview */}
      <section aria-labelledby="process-heading" className="flex flex-col gap-6">
        <div>
          <p className="eyebrow">How It Works</p>
          <h2 id="process-heading" className="mt-2 text-2xl font-bold sm:text-3xl">
            Effortless catering in three simple steps
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="surface flex flex-col gap-3 p-6 border-l-4 border-l-saffron-500">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-saffron-600 dark:text-saffron-400">
              Step 01
            </span>
            <h3 className="text-lg font-bold">Select Your Dishes</h3>
            <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">
              Browse our Hyderabadi specialties across biryanis, gravies, breads, and desserts. Choose quantities that fit your vision.
            </p>
          </div>

          <div className="surface flex flex-col gap-3 p-6 border-l-4 border-l-saffron-500">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-saffron-600 dark:text-saffron-400">
              Step 02
            </span>
            <h3 className="text-lg font-bold">Event Details</h3>
            <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">
              Tell us your event date, estimated guest count, and any dietary preferences or spice requests.
            </p>
          </div>

          <div className="surface flex flex-col gap-3 p-6 border-l-4 border-l-saffron-500">
            <span className="font-display text-sm font-bold uppercase tracking-wider text-saffron-600 dark:text-saffron-400">
              Step 03
            </span>
            <h3 className="text-lg font-bold">Direct WhatsApp Confirmation</h3>
            <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-300">
              Submit your inquiry with one tap to open WhatsApp. Our chef reviews and confirms timing, logistics, and quote.
            </p>
          </div>
        </div>

        <div className="mt-2 flex justify-start">
          <button type="button" onClick={onStartOrdering} className="btn-primary">
            Start Your Catering Order →
          </button>
        </div>
      </section>
    </div>
  );
}
