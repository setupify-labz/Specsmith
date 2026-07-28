import { useState } from 'react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { generatePriceHistory, getPriceStats, getSparklineTrend } from '../lib/priceHistory';
import { useToast } from '../context/ToastContext';

interface Props {
  partId: string;
  currentPrice: number;
  partName: string;
}

export default function PriceSparkline({ partId, currentPrice, partName }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const { showToast } = useToast();

  const history = generatePriceHistory(currentPrice, partId);
  const trend = getSparklineTrend(history, currentPrice);
  const stats = getPriceStats(history, currentPrice);

  const trendColor = trend === 'down' ? '#00E676' : trend === 'up' ? '#FF1744' : '#8888AA';
  const TrendIcon = trend === 'down' ? TrendingDown : trend === 'up' ? TrendingUp : Minus;
  const trendLabel = `${trend === 'down' ? '↓' : trend === 'up' ? '↑' : '—'} ${Math.abs(stats.trendPct)}% est. 12-month trend`;

  return (
    <>
      <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--ff-border)' }}>
        {/* Sparkline */}
        <div style={{ height: 48, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <Line
                type="monotone"
                dataKey="price"
                stroke={trendColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={true}
                animationDuration={500}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: trendColor }}>
            <TrendIcon size={10} />
            {trendLabel}
          </span>
          <button
            onClick={e => { e.stopPropagation(); setModalOpen(true); }}
            className="text-[10px] font-medium hover:opacity-80 transition-opacity"
            style={{ color: 'var(--ff-accent-text)' }}
          >
            Price History
          </button>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ backgroundColor: 'var(--ff-modal-bg)', backdropFilter: 'blur(4px)' }}
            onClick={() => setModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
              style={{ backgroundColor: 'var(--ff-surface)', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-base" style={{ color: 'var(--ff-text)' }}>{partName}</h3>
                  <p className="text-xs" style={{ color: 'var(--ff-text-2)' }}>12-Month Price Trend (estimated)</p>
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Full chart */}
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: 'var(--ff-text-3)' }}
                      tickFormatter={v => v.split(' ')[0]}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--ff-text-3)' }}
                      tickFormatter={v => `$${v}`}
                      width={55}
                    />
                    <Tooltip
                      formatter={(v: number) => [`$${v.toLocaleString()}`, 'Price']}
                      contentStyle={{
                        backgroundColor: 'var(--ff-card)',
                        border: '1px solid var(--ff-border)',
                        borderRadius: 8,
                        color: 'var(--ff-text)',
                        fontSize: 12,
                      }}
                    />
                    <ReferenceLine
                      y={currentPrice}
                      stroke="var(--ff-accent)"
                      strokeDasharray="4 2"
                      label={{ value: 'Today', fill: 'var(--ff-accent)', fontSize: 10 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke={trendColor}
                      strokeWidth={2}
                      dot={{ r: 3, fill: trendColor, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { label: '12-Month Low', value: `$${stats.minPrice.toLocaleString()}`, sub: stats.minMonth },
                  { label: '12-Month High', value: `$${stats.maxPrice.toLocaleString()}`, sub: stats.maxMonth },
                  { label: 'Price Trend', value: `${stats.trendPct > 0 ? '↑' : '↓'} ${Math.abs(stats.trendPct)}%`, sub: 'this year', color: stats.trendPct > 0 ? '#FF1744' : '#00E676' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--ff-card)' }}>
                    <p className="text-[10px] mb-1" style={{ color: 'var(--ff-text-2)' }}>{stat.label}</p>
                    <p className="text-sm font-bold" style={{ color: stat.color ?? 'var(--ff-text)' }}>{stat.value}</p>
                    <p className="text-[10px]" style={{ color: 'var(--ff-text-3)' }}>{stat.sub}</p>
                  </div>
                ))}
              </div>

              {/* Badge + alert */}
              <div className="flex items-center justify-between mt-4">
                {stats.badge === 'great' && (
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: '#00E67618', color: '#00E676', border: '1px solid #00E67640' }}>
                    Below typical price (est.)
                  </span>
                )}
                {stats.badge === 'high' && (
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: '#FF174418', color: '#FF1744', border: '1px solid #FF174440' }}>
                    Above typical price (est.)
                  </span>
                )}
                {stats.badge === 'average' && (
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}>
                    Near typical price (est.)
                  </span>
                )}
                <button
                  onClick={() => showToast('Price alerts coming soon!', 'info')}
                  className="text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ color: 'var(--ff-accent-text)' }}
                >
                  Set Price Alert
                </button>
              </div>

              <p className="text-[10px] mt-4 leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
                Trend is a modeled estimate based on typical market seasonality for this part's current price — not actual retailer price history. Check retailers for real historical pricing before timing a purchase.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
