import { formatCitation, type Citation } from './format';
import styles from '../study.module.css';

export default function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label="Sources">
      {citations.map((c) => (
        <li key={c.chunkId} className={styles.chip}>{formatCitation(c)}</li>
      ))}
    </ul>
  );
}
