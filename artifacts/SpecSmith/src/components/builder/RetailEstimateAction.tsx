interface Props {
  canEstimate: boolean;
  onEstimate: () => void;
}

export default function RetailEstimateAction({ canEstimate, onEstimate }: Props) {
  return (
    /* TIGHTER, WORD FOR WORD THE SAME. This block sat inside a sidebar that a
       guide plan had already filled, and its padding put the button below the
       fold at 1366x768. Nothing is removed — the explanation a shopper needs in
       order to understand a withheld estimate is exactly as long as it was. */
    <section aria-label="Build performance" className="my-3 rounded-xl border border-subtle p-3">
      <h2 className="text-base font-bold mb-1.5">Estimate your gaming performance</h2>
      <p id="retail-estimate-help" className="text-xs leading-snug text-secondary-custom mb-2.5">
        {canEstimate
          /* SAYS WHAT IS ACTUALLY KNOWN. This read "have supported
             specifications", which is a claim about the products selected —
             and for a retailer listing nothing has measured them. What the
             estimator has is a mapping from each selection to a model it
             supports, which is enough for an estimate and is not a
             specification. */
          ? 'Both selections map to models the estimator supports. Compare estimated FPS across games, resolutions, and presets — estimated for the model, not measured from these exact products.'
          : 'Select a GPU and CPU with verified mappings to the estimator. Some retailer products are not supported yet; we will not guess their performance.'}
      </p>
      <button type="button" disabled={!canEstimate} onClick={onEstimate}
        aria-describedby="retail-estimate-help"
        className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-on-accent)' }}>
        Estimate FPS
      </button>
    </section>
  );
}
