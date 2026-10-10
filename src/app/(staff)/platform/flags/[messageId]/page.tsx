import Link from 'next/link';
import styles from '../../../staff.module.css';
import { requirePageActor } from '@/lib/guard';
import ConversationView from '../../_components/ConversationView';
import { pageError } from '../../_components/PageError';
import PlatformNav from '../../_components/PlatformNav';
import ReviewButton from '../../_components/ReviewButton';
import { loadFlagged } from '../../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Flag · AI Tutor for Schools' };

export default async function FlagPage({ params }: { params: Promise<{ messageId: string }> }) {
  const actor = await requirePageActor(['platform']);
  const { messageId } = await params;
  let conv: Awaited<ReturnType<typeof loadFlagged>>;
  try {
    conv = await loadFlagged(actor, messageId);
  } catch (e) {
    return pageError('Flag', e);
  }
  return (
    <>
      <h1 className={styles.title}>Flagged conversation</h1>
      <PlatformNav />
      <p><Link href="/platform/flags">Back to flags</Link></p>
      <ConversationView messages={conv.messages} flaggedMessageId={conv.flaggedMessageId} />
      <ReviewButton messageId={conv.flaggedMessageId} reviewedAt={conv.reviewedAt} />
    </>
  );
}
