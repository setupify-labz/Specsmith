interface Props {
  canEstimate: boolean;
  onEstimate: () => void;
}

export default function RetailEstimateAction({ canEstimate, onEstimate }: Props) {
  return (
    <section aria-label="Build performance" className="my-6 rounded-xl border border-subtle p-4">
      <h2 className="text-lg font-bold mb-2">Estimate your gaming performance</h2>
      <p id="retail-estimate-help" className="text-sm text-secondary-custom mb-3">
        {canEstimate
          ? 'Your selected GPU and CPU have supported specifications. Compare estimated FPS across games, resolutions, and presets.'
          : 'Select a GPU and CPU with verified mappings to the estimator. Some retailer products are not supported yet; we will not guess their performance.'}
      </p>
      <button type="button" disabled={!canEstimate} onClick={onEstimate}
        aria-describedby="retail-estimate-help"
        className="rounded-lg px-5 py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-on-accent)' }}>
        Estimate FPS
      </button>
    </section>
  );
}
