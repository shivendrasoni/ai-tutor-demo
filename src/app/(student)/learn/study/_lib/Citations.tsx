import { Badge } from '@/components/ui/badge';
import { formatCitation, type Citation } from './format';

export default function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((c) => (
        <li key={c.chunkId}>
          <Badge variant="secondary" className="font-normal">{formatCitation(c)}</Badge>
        </li>
      ))}
    </ul>
  );
}
