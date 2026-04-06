import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Zap, ExternalLink } from 'lucide-react';
import prebuiltsData from '../data/prebuilts.json';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import { getAffiliateUrl } from '../lib/fps';

interface Prebuilt {
  id: string; name: string; tagline: string; description: string;
  target_resolution: string; estimated_price: number;
  parts: Record<string, string>;
  fps_preview: { game: string; fps: number }[];
}

const prebuilts = prebuiltsData as Prebuilt[];

function getPartName(category: string, id: string): string {
  if (category === 'gpu') return (gpuData as any[]).find(g => g.id === id)?.name ?? id;
  if (category === 'cpu') return (cpuData as any[]).find(c => c.id === id)?.name ?? id;
  if (category === 'motherboard') return (componentData.motherboards as any[]).find(m => m.id === id)?.name ?? id;
  if (category === 'ram') return (componentData.ram as any[]).find(r => r.id === id)?.name ?? id;
  if (category === 'storage') return (componentData.storage as any[]).find(s => s.id === id)?.name ?? id;
  if (category === 'psu') return (componentData.psus as any[]).find(p => p.id === id)?.name ?? id;
  if (category === 'case') return (componentData.cases as any[]).find(c => c.id === id)?.name ?? id;
  if (category === 'cooler') return (componentData.coolers as any[]).find(c => c.id === id)?.name ?? id;
  return id;
}

const categoryLabels: Record<string, string> = {
  gpu: 'GPU', cpu: 'CPU', motherboard: 'Motherboard', ram: 'RAM',
  storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'CPU Cooler',
};

const budgetColors = ['#FFB300', '#6C63FF', '#00D4FF', '#00E676', '#FF1744'];

export default function Prebuilts() {
  const navigate = useNavigate();

  const handleLoad = (prebuilt: Prebuilt) => {
    const params = new URLSearchParams();
    Object.entries(prebuilt.parts).forEach(([k, v]) => params.set(k, v));
    navigate(`/builder?${params.toString()}`);
  };

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4">
            Curated <span className="gradient-text">Builds</span>
          </h1>
          <p className="text-[#8888AA] text-lg max-w-xl mx-auto">
            Expert-selected configurations for every budget. Load any build into the builder to customize it.
          </p>
        </motion.div>

        {/* Build cards */}
        <div className="space-y-8">
          {prebuilts.map((prebuilt, i) => (
            <motion.div
              key={prebuilt.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl border border-white/8 bg-[#1C1C26] overflow-hidden"
            >
              {/* Build header */}
              <div className="p-6 border-b border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: budgetColors[i % budgetColors.length] }}
                      />
                      <h2 className="text-2xl font-black text-white">{prebuilt.name}</h2>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-[#8888AA]">
                        {prebuilt.target_resolution}
                      </span>
                    </div>
                    <p className="text-[#8888AA] text-sm font-medium mb-1">{prebuilt.tagline}</p>
                    <p className="text-[#8888AA] text-sm max-w-xl">{prebuilt.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-3xl font-black gradient-text">${prebuilt.estimated_price.toLocaleString()}</div>
                    <div className="text-[#8888AA] text-xs">Estimated total</div>
                  </div>
                </div>
              </div>

              {/* Parts list */}
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-b border-white/5">
                {Object.entries(prebuilt.parts).map(([cat, id]) => {
                  const name = getPartName(cat, id);
                  return (
                    <div key={cat} className="rounded-lg bg-white/3 p-3 border border-white/5">
                      <div className="text-[10px] text-[#8888AA] uppercase tracking-wider mb-1">{categoryLabels[cat]}</div>
                      <div className="text-white text-xs font-medium leading-tight mb-2">{name}</div>
                      <a
                        href={getAffiliateUrl(name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-[#6C63FF] hover:text-[#00D4FF] transition-colors"
                      >
                        Buy on Amazon <ExternalLink size={9} />
                      </a>
                    </div>
                  );
                })}
              </div>

              {/* FPS Preview + Load button */}
              <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-[#8888AA] uppercase tracking-wider mb-2 font-medium">FPS Preview — 1080p High</div>
                  <div className="flex gap-4">
                    {prebuilt.fps_preview.map(fp => (
                      <div key={fp.game} className="text-center">
                        <div className="text-lg font-black text-[#00E676]">{fp.fps}</div>
                        <div className="text-[#8888AA] text-xs max-w-20 leading-tight">{fp.game}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleLoad(prebuilt)}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm transition-all hover:opacity-90 hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
                >
                  <Zap size={16} />
                  Load into Builder
                  <ChevronRight size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
