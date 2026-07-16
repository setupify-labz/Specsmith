import { useParams } from 'react-router-dom';
import GpuMatchup from './GpuMatchup';
import CpuMatchup from './CpuMatchup';
import { getCpuMatchup } from '../lib/matchups';

// GPU and CPU matchups share the /vs/<slug> URL space; slugs are unique
// across both lists. GpuMatchup also renders the not-found fallback.
export default function Matchup() {
  const { slug } = useParams<{ slug: string }>();
  return slug && getCpuMatchup(slug) ? <CpuMatchup /> : <GpuMatchup />;
}
