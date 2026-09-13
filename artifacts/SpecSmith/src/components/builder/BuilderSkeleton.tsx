/**
 * What `/builder` shows while the retailer catalogue is still loading.
 *
 * THE DEFECT THIS REPLACES (issue #104). The page rendered the legacy
 * canonical builder for every state that was not `ok`, and the catalogue is
 * fetched in the browser — so an ordinary visit painted the old interface,
 * then swapped the whole region for the new one when the request landed. It
 * looked like the site could not decide which builder it had.
 *
 * IT CLAIMS NOTHING. There are no product names, no prices, no availability,
 * no retailer links and no counts here — not even plausible-looking ones.
 * Every bar is an empty shape. A skeleton that invents "$299.99" to look
 * convincing is a price the shopper read and we made up, and this repository
 * does not do that even for a third of a second.
 *
 * IT IS NOT INTERACTIVE. Nothing inside is focusable and the whole region is
 * `aria-hidden`, so a keyboard user cannot tab into shapes that do nothing and
 * a screen reader is not read a wall of meaningless boxes. What a screen
 * reader gets instead is the single polite status message beside it — one
 * sentence, not a running commentary.
 *
 * IT MIRRORS THE REAL LAYOUT, which is the whole point: the same toggle row,
 * the same 224/240px rail, the same centre column, the same 320/360px summary,
 * the same card grid and the same 240px / 4:3 image frames. When the catalogue
 * arrives, boxes are replaced by content in place rather than the page
 * changing shape under the reader.
 */

/** One neutral placeholder block. Deliberately the only visual primitive here. */
function Bar({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`retail-skeleton-bar rounded ${className}`}
      style={style}
    />
  );
}

function CardSkeleton() {
  return (
    <div
      className="flex flex-col rounded-xl border"
      style={{ background: 'var(--ff-card)', borderColor: 'var(--ff-border)' }}
      data-testid="builder-skeleton-card"
    >
      {/* The same frame the real card uses: 240px on a phone, 4:3 from md up,
          so a loaded photograph lands exactly where the box was. */}
      <div className="retail-photo-frame h-[240px] rounded-t-xl md:h-auto md:aspect-[4/3]" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Bar className="h-4 w-[85%]" />
        <Bar className="h-4 w-[60%]" />
        <Bar className="h-5 w-24" />
        <Bar className="h-3 w-[70%]" />
        <div className="mt-1 flex gap-2">
          <Bar className="h-9 flex-1" />
          <Bar className="h-9 flex-1" />
        </div>
      </div>
    </div>
  );
}

/** How many cards the skeleton draws. The real grid's first batch is 24; a
 *  screenful is enough to hold the layout without painting 24 empty boxes. */
const SKELETON_CARDS = 6;

export default function BuilderSkeleton() {
  return (
    <div data-testid="builder-skeleton">
      {/* ONE polite announcement, outside the aria-hidden shapes. `polite` and
          a single unchanging sentence: a shopper using a screen reader is told
          the products are loading once, and is not interrupted again when they
          arrive — the products themselves are the announcement then. */}
      <p
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="builder-loading-status"
      >
        Loading the product catalogue.
      </p>

      <div aria-hidden="true">
        {/* The White build toggle row. */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Bar className="h-9 w-36 rounded-full" />
        </div>

        {/* Mobile category chips. */}
        <div className="mb-4 flex gap-2 overflow-hidden lg:hidden">
          {[72, 64, 80, 68, 76].map((width, index) => (
            <Bar key={index} className="h-9 shrink-0 rounded-full" style={{ width }} />
          ))}
        </div>

        <div className="flex gap-6">
          {/* Left rail — the same 224/240px it will be. */}
          <div className="hidden w-56 shrink-0 lg:block 2xl:w-60">
            <div className="space-y-2">
              <Bar className="h-3 w-24" />
              {Array.from({ length: 6 }, (_, index) => (
                <Bar key={index} className="h-9 w-full" />
              ))}
              <Bar className="mt-4 h-3 w-28" />
              {Array.from({ length: 3 }, (_, index) => (
                <Bar key={`b${index}`} className="h-9 w-full" />
              ))}
            </div>
          </div>

          {/* Centre catalogue. */}
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Bar className="h-6 w-40" />
              <Bar className="h-4 w-24" />
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Bar className="h-11 min-w-0 flex-1" />
              <Bar className="h-11 w-44" />
              <Bar className="h-11 w-24" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </div>
          </div>

          {/* Right summary — the same 320/360px it will be. */}
          <div className="hidden w-80 shrink-0 xl:block 2xl:w-[360px]">
            <div
              className="rounded-xl p-4"
              style={{ background: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
            >
              <Bar className="h-5 w-32" />
              <Bar className="mt-4 h-4 w-full" />
              <Bar className="mt-2 h-4 w-2/3" />
              <Bar className="mt-6 h-24 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
