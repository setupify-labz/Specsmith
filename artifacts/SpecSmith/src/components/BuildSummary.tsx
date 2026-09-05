import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, DollarSign, Save, Download, Copy, Check, PackageOpen, RotateCcw, FileDown, FileUp } from 'lucide-react';
import { buildPartQuery } from '../lib/fps';
import { getAmazonLink, getNeweggLink } from '../lib/retailerLinkState';
import RetailerLinkCta from './RetailerLinkCta';
import { downloadBuildFile, parseBuildFileContent, type ShareView, type SharedCustomPart } from '../lib/sharing';
import { PRICES_UPDATED } from '../lib/prices';
import { downloadBuildCard, copyBuildCardToClipboard } from '../lib/buildCard';
import { useToast } from '../context/ToastContext';
import BottleneckChecker from './BottleneckChecker';
import ShareButton from './ShareButton';
import SaveBuildModal from './SaveBuildModal';

interface SummaryPart {
  label: string;
  name: string;
  price?: number;
  affiliateUrl?: string;
  customId?: string;
}

export interface CustomPart {
  id: string;
  name: string;
  price: number;
}

interface Props {
  parts: SummaryPart[];
  totalCost: number;
  onEstimateFps: () => void;
  canEstimate: boolean;
  compatibilityOk: boolean;
  gpu?: { benchmark_score: number; name: string; gpu_multiplier: number } | null;
  cpu?: { benchmark_score: number; name: string; cpu_multiplier: number } | null;
  buildState: Record<string, string | null>;
  buildName?: string;
  shareView?: ShareView;
  customParts?: CustomPart[];
  onAddCustomPart?: (name: string, price: number) => void;
  onRemoveCustomPart?: (id: string) => void;
  onScrollToGpu?: () => void;
  onScrollToCpu?: () => void;
  onStartOver?: () => void;
  onImportBuild?: (imported: { build: Record<string, string | null>; name: string; view: ShareView | null; customParts: SharedCustomPart[] }) => void;
}

export default function BuildSummary({
  parts, totalCost, onEstimateFps, canEstimate, compatibilityOk,
  gpu, cpu, buildState, buildName, shareView,
  customParts = [], onAddCustomPart, onRemoveCustomPart,
  onScrollToGpu, onScrollToCpu, onStartOver, onImportBuild,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [cardState, setCardState] = useState<'idle' | 'downloading' | 'copying' | 'copied'>('idle');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [taxPct, setTaxPct] = useState('');
  const [startOverConfirm, setStartOverConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleExportFile = () => {
    downloadBuildFile(buildState, buildName, shareView, customParts);
    showToast(`Exported "${buildName ?? 'My SpecSmith Build'}"`, 'success');
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file || !onImportBuild) return;
    try {
      const text = await file.text();
      const parsed = parseBuildFileContent(text);
      if (!parsed) {
        showToast('That file isn\'t a valid SpecSmith build export', 'error');
        return;
      }
      onImportBuild(parsed);
      showToast(`Imported "${parsed.name}"`, 'success');
    } catch {
      showToast('Failed to read that file', 'error');
    }
  };

  const taxRate = parseFloat(taxPct);
  const taxValid = !isNaN(taxRate) && taxRate > 0 && taxRate < 30;

  const submitCustomPart = () => {
    const price = parseFloat(customPrice);
    if (!customName.trim() || isNaN(price) || price < 0) return;
    onAddCustomPart?.(customName.trim(), Math.round(price));
    setCustomName('');
    setCustomPrice('');
    setCustomOpen(false);
  };

  const cardOptions = {
    buildName,
    parts,
    totalCost,
    gpu: gpu ? { name: gpu.name, gpu_multiplier: gpu.gpu_multiplier } : null,
    cpu: cpu ? { name: cpu.name, cpu_multiplier: cpu.cpu_multiplier } : null,
  };

  const handleDownload = async () => {
    if (cardState !== 'idle') return;
    setCardState('downloading');
    try {
      await downloadBuildCard(cardOptions);
    } finally {
      setCardState('idle');
    }
  };

  const handleCopy = async () => {
    if (cardState !== 'idle') return;
    setCardState('copying');
    try {
      await copyBuildCardToClipboard(cardOptions);
      setCardState('copied');
      setTimeout(() => setCardState('idle'), 2000);
    } catch {
      setCardState('idle');
    }
  };

  const supportsClipboardWrite = typeof ClipboardItem !== 'undefined';
  // Every retailer CTA a non-custom part renders is a fallback-search link
  // today (see retailerLinkState.ts: neither getAmazonLink nor
  // getNeweggLink can currently return 'exact' in this component tier).
  const hasFallbackSearchParts = parts.some((part) => !part.customId);
  const hasUnknownPrices = parts.some((part) => part.price === undefined);

  return (
    <>
      <div
        className="rounded-2xl p-5 sticky top-20"
        style={{
          border: '1px solid var(--ff-border)',
          backgroundColor: 'var(--ff-surface)',
          boxShadow: '0 12px 32px -12px rgba(0,0,0,0.12)',
        }}
      >
        <h2 className="font-bold text-lg mb-4 flex items-center gap-2" style={{ color: 'var(--ff-text)' }}>
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            <DollarSign size={16} className="text-white" />
          </span>
          Build Summary
        </h2>

        {/* Parts list */}
        <div className="space-y-2 mb-4 min-h-[100px]">
          <AnimatePresence>
            {parts.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center text-center py-8 gap-2">
                <PackageOpen size={28} style={{ color: 'var(--ff-text-3)' }} />
                <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>Select components to build your PC</p>
              </motion.div>
            )}
            {parts.map(p => (
              <motion.div
                key={p.customId ?? p.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-center justify-between gap-2 py-2 last:border-0"
                style={{ borderBottom: '1px solid var(--ff-border)' }}
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] uppercase tracking-wider" style={{ color: 'var(--ff-text-3)' }}>{p.label}</span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs font-medium truncate" style={{ color: 'var(--ff-text)' }}>{p.name}</span>
                    {p.customId ? (
                      <button onClick={() => onRemoveCustomPart?.(p.customId!)}
                        title="Remove custom part"
                        className="flex-shrink-0 text-[9px] font-bold transition-opacity hover:opacity-80"
                        style={{ color: 'var(--ff-red)' }}>
                        Remove
                      </button>
                    ) : (
                      (() => {
                        const query = buildPartQuery(p.name, undefined, p.label.toLowerCase());
                        const amazonLink = getAmazonLink(query);
                        const neweggLink = getNeweggLink(query, p.affiliateUrl);
                        return (
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <RetailerLinkCta
                              retailer="Amazon"
                              partName={p.name}
                              link={amazonLink}
                              variant="text"
                              accentColor="var(--ff-accent-text)"
                            />
                            <RetailerLinkCta
                              retailer="Newegg"
                              partName={p.name}
                              link={neweggLink}
                              variant="text"
                              accentColor="var(--ff-newegg)"
                            />
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
                <span
                  className="text-sm font-semibold whitespace-nowrap"
                  style={{ color: 'var(--ff-text)' }}
                  title={!p.customId && p.price !== undefined ? 'Estimated catalog price — verify the current price at the retailer' : undefined}
                >
                  {p.price === undefined ? 'Retailer price' : p.customId ? '
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {hasFallbackSearchParts && (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              &quot;Search&quot; links open a retailer search, not the exact product — confirm the model, price, and availability before buying.
            </p>
          )}

          {/* Custom / unlisted part */}
          {onAddCustomPart && (
            customOpen ? (
              <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Part name (e.g. RGB fan kit, used GPU)"
                  className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitCustomPart()}
                    placeholder="Price ($)"
                    inputMode="decimal"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs focus:outline-none"
                    style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                  />
                  <button onClick={submitCustomPart}
                    className="px-3 py-1.5 rounded-md text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Add
                  </button>
                  <button onClick={() => setCustomOpen(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-semibold"
                    style={{ color: 'var(--ff-text-2)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCustomOpen(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px dashed var(--ff-border)', color: 'var(--ff-text-2)' }}>
                + Add custom part (anything not in our list)
              </button>
            )
          )}
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>{hasUnknownPrices ? 'Estimated known-price subtotal' : 'Estimated total'}</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--ff-text-3)' }}>
            {hasUnknownPrices ? 'Retailer-priced selections are excluded from this subtotal' : `Est. street pricing · updated ${PRICES_UPDATED}`}
          </p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
              Sales tax
              <input
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="w-11 px-1.5 py-0.5 rounded text-[10px] text-right focus:outline-none"
                style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              />
              %
            </label>
            <span className="text-[10px]" style={{ color: taxValid ? 'var(--ff-text-2)' : 'var(--ff-text-3)' }}>
              {taxValid
                ? 'Estimated with tax: 
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
 + p.price.toLocaleString() : 'Est. 
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {hasFallbackSearchParts && (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              &quot;Search&quot; links open a retailer search, not the exact product — confirm the model, price, and availability before buying.
            </p>
          )}

          {/* Custom / unlisted part */}
          {onAddCustomPart && (
            customOpen ? (
              <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Part name (e.g. RGB fan kit, used GPU)"
                  className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitCustomPart()}
                    placeholder="Price ($)"
                    inputMode="decimal"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs focus:outline-none"
                    style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                  />
                  <button onClick={submitCustomPart}
                    className="px-3 py-1.5 rounded-md text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Add
                  </button>
                  <button onClick={() => setCustomOpen(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-semibold"
                    style={{ color: 'var(--ff-text-2)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCustomOpen(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px dashed var(--ff-border)', color: 'var(--ff-text-2)' }}>
                + Add custom part (anything not in our list)
              </button>
            )
          )}
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>{hasUnknownPrices ? 'Estimated known-price subtotal' : 'Estimated total'}</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--ff-text-3)' }}>
            {hasUnknownPrices ? 'Retailer-priced selections are excluded from this subtotal' : `Est. street pricing · updated ${PRICES_UPDATED}`}
          </p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
              Sales tax
              <input
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="w-11 px-1.5 py-0.5 rounded text-[10px] text-right focus:outline-none"
                style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              />
              %
            </label>
            <span className="text-[10px]" style={{ color: taxValid ? 'var(--ff-text-2)' : 'var(--ff-text-3)' }}>
              {taxValid
                ? `Estimated with tax: ${Math.round(totalCost * (1 + taxRate / 100)).toLocaleString()}`
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
 + p.price.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {hasFallbackSearchParts && (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              &quot;Search&quot; links open a retailer search, not the exact product — confirm the model, price, and availability before buying.
            </p>
          )}

          {/* Custom / unlisted part */}
          {onAddCustomPart && (
            customOpen ? (
              <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Part name (e.g. RGB fan kit, used GPU)"
                  className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitCustomPart()}
                    placeholder="Price ($)"
                    inputMode="decimal"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs focus:outline-none"
                    style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                  />
                  <button onClick={submitCustomPart}
                    className="px-3 py-1.5 rounded-md text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Add
                  </button>
                  <button onClick={() => setCustomOpen(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-semibold"
                    style={{ color: 'var(--ff-text-2)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCustomOpen(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px dashed var(--ff-border)', color: 'var(--ff-text-2)' }}>
                + Add custom part (anything not in our list)
              </button>
            )
          )}
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>{hasUnknownPrices ? 'Estimated known-price subtotal' : 'Estimated total'}</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--ff-text-3)' }}>
            {hasUnknownPrices ? 'Retailer-priced selections are excluded from this subtotal' : `Est. street pricing · updated ${PRICES_UPDATED}`}
          </p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
              Sales tax
              <input
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="w-11 px-1.5 py-0.5 rounded text-[10px] text-right focus:outline-none"
                style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              />
              %
            </label>
            <span className="text-[10px]" style={{ color: taxValid ? 'var(--ff-text-2)' : 'var(--ff-text-3)' }}>
              {taxValid
                ? `Estimated with tax: ${Math.round(totalCost * (1 + taxRate / 100)).toLocaleString()}`
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
 + Math.round(totalCost * (1 + taxRate / 100)).toLocaleString()
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
 + p.price.toLocaleString() : 'Est. 
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {hasFallbackSearchParts && (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              &quot;Search&quot; links open a retailer search, not the exact product — confirm the model, price, and availability before buying.
            </p>
          )}

          {/* Custom / unlisted part */}
          {onAddCustomPart && (
            customOpen ? (
              <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Part name (e.g. RGB fan kit, used GPU)"
                  className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitCustomPart()}
                    placeholder="Price ($)"
                    inputMode="decimal"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs focus:outline-none"
                    style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                  />
                  <button onClick={submitCustomPart}
                    className="px-3 py-1.5 rounded-md text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Add
                  </button>
                  <button onClick={() => setCustomOpen(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-semibold"
                    style={{ color: 'var(--ff-text-2)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCustomOpen(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px dashed var(--ff-border)', color: 'var(--ff-text-2)' }}>
                + Add custom part (anything not in our list)
              </button>
            )
          )}
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>{hasUnknownPrices ? 'Estimated known-price subtotal' : 'Estimated total'}</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--ff-text-3)' }}>
            {hasUnknownPrices ? 'Retailer-priced selections are excluded from this subtotal' : `Est. street pricing · updated ${PRICES_UPDATED}`}
          </p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
              Sales tax
              <input
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="w-11 px-1.5 py-0.5 rounded text-[10px] text-right focus:outline-none"
                style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              />
              %
            </label>
            <span className="text-[10px]" style={{ color: taxValid ? 'var(--ff-text-2)' : 'var(--ff-text-3)' }}>
              {taxValid
                ? `Estimated with tax: ${Math.round(totalCost * (1 + taxRate / 100)).toLocaleString()}`
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
 + p.price.toLocaleString()}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {hasFallbackSearchParts && (
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
              &quot;Search&quot; links open a retailer search, not the exact product — confirm the model, price, and availability before buying.
            </p>
          )}

          {/* Custom / unlisted part */}
          {onAddCustomPart && (
            customOpen ? (
              <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                <input
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="Part name (e.g. RGB fan kit, used GPU)"
                  className="w-full px-2 py-1.5 rounded-md text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                />
                <div className="flex items-center gap-2">
                  <input
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitCustomPart()}
                    placeholder="Price ($)"
                    inputMode="decimal"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md text-xs focus:outline-none"
                    style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
                  />
                  <button onClick={submitCustomPart}
                    className="px-3 py-1.5 rounded-md text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                    Add
                  </button>
                  <button onClick={() => setCustomOpen(false)}
                    className="px-2 py-1.5 rounded-md text-xs font-semibold"
                    style={{ color: 'var(--ff-text-2)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCustomOpen(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ border: '1px dashed var(--ff-border)', color: 'var(--ff-text-2)' }}>
                + Add custom part (anything not in our list)
              </button>
            )
          )}
        </div>

        {/* Total */}
        <div className="pt-4 mb-4" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }}>{hasUnknownPrices ? 'Estimated known-price subtotal' : 'Estimated total'}</span>
            <span className="text-2xl font-black" style={{ color: 'var(--ff-text)' }}>${totalCost.toLocaleString()}</span>
          </div>
          <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--ff-text-3)' }}>
            {hasUnknownPrices ? 'Retailer-priced selections are excluded from this subtotal' : `Est. street pricing · updated ${PRICES_UPDATED}`}
          </p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ff-text-3)' }}>
              Sales tax
              <input
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="w-11 px-1.5 py-0.5 rounded text-[10px] text-right focus:outline-none"
                style={{ backgroundColor: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              />
              %
            </label>
            <span className="text-[10px]" style={{ color: taxValid ? 'var(--ff-text-2)' : 'var(--ff-text-3)' }}>
              {taxValid
                ? `Estimated with tax: ${Math.round(totalCost * (1 + taxRate / 100)).toLocaleString()}`
                : 'Prices exclude sales tax'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={onEstimateFps}
            disabled={!canEstimate}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
              canEstimate ? 'text-white hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]'
                         : 'cursor-not-allowed opacity-50'
            }`}
            style={canEstimate ? { background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }
                               : { backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            <Zap size={16} />
            {canEstimate ? 'Estimate FPS' : 'Select GPU + CPU to estimate'}
          </button>

          {/* Save + Share */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => setSaveOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
              >
                <Save size={14} />
                Save Build
              </button>
              <ShareButton buildState={buildState} view={shareView} customParts={customParts} size="sm" />
            </motion.div>
          )}

          {/* Build Card buttons */}
          {canEstimate && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={handleDownload}
                disabled={cardState !== 'idle'}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                style={{
                  border: '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-card)',
                  color: 'var(--ff-text)',
                }}
                title="Download as PNG"
              >
                <Download size={13} />
                {cardState === 'downloading' ? 'Generating…' : 'Build Card'}
              </button>

              {supportsClipboardWrite && (
                <button
                  onClick={handleCopy}
                  disabled={cardState !== 'idle'}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-60"
                  style={{
                    border: '1px solid var(--ff-border)',
                    backgroundColor: cardState === 'copied' ? 'rgba(0,230,118,0.1)' : 'var(--ff-card)',
                    color: cardState === 'copied' ? 'var(--ff-green)' : 'var(--ff-text-2)',
                    minWidth: 40,
                  }}
                  title="Copy image to clipboard"
                >
                  {cardState === 'copied'
                    ? <Check size={13} />
                    : cardState === 'copying'
                    ? <span className="animate-spin inline-block text-[10px]">⟳</span>
                    : <Copy size={13} />
                  }
                </button>
              )}
            </motion.div>
          )}

          {/* Export / Import build file — a plain JSON backup that works
              with no account and no backend, and is the only way today to
              move a build to another browser or device (saved builds only
              live in this browser's localStorage). */}
          {(parts.length > 0 || onImportBuild) && (
            <div className="flex items-center gap-2">
              {parts.length > 0 && (
                <button
                  onClick={handleExportFile}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                  style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                  title="Download this build as a JSON file"
                >
                  <FileDown size={12} />
                  Export File
                </button>
              )}
              {onImportBuild && (
                <>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
                    style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text-2)' }}
                    title="Load a previously exported build file"
                  >
                    <FileUp size={12} />
                    Import File
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFileChange}
                    className="hidden"
                    aria-label="Import build file"
                  />
                </>
              )}
            </div>
          )}

          {/* Start Over */}
          {onStartOver && parts.length > 0 && (
            <button
              onClick={() => {
                if (!startOverConfirm) { setStartOverConfirm(true); return; }
                onStartOver();
                setStartOverConfirm(false);
              }}
              onBlur={() => setStartOverConfirm(false)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl font-medium text-xs transition-all hover:opacity-80"
              style={{ color: startOverConfirm ? 'var(--ff-red)' : 'var(--ff-text-3)' }}
            >
              <RotateCcw size={12} />
              {startOverConfirm ? 'Click again to clear this build' : 'Start Over'}
            </button>
          )}
        </div>

        {/* Bottleneck Checker */}
        {gpu && cpu && (
          <BottleneckChecker
            gpuScore={gpu.benchmark_score}
            cpuScore={cpu.benchmark_score}
            onFixGpu={onScrollToGpu}
            onFixCpu={onScrollToCpu}
          />
        )}
      </div>

      <SaveBuildModal open={saveOpen} onClose={() => setSaveOpen(false)} buildState={buildState} />
    </>
  );
}
