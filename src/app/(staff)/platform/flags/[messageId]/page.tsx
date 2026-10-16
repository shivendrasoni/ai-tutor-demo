'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import ConversationView from '../../_components/ConversationView';
import { pageError } from '../../_components/PageError';
import PlatformNav from '../../_components/PlatformNav';
import ReviewButton from '../../_components/ReviewButton';
import { usePlatform } from '../../_components/usePlatform';
import { selectFlagged } from '@/demo/areas/platform/selectors';

export default function FlagPage() {
  const { messageId } = useParams<{ messageId: string }>();
  const s = usePlatform();
  let conv: ReturnType<typeof selectFlagged>;
  try {
    conv = selectFlagged(s, messageId);
  } catch (e) {
    return pageError('Flag', e);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Flagged conversation</h1>
      <PlatformNav />
      <p>
        <Link href="/platform/flags" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />Back to flags
        </Link>
      </p>
      <ConversationView messages={conv.messages} flaggedMessageId={conv.flaggedMessageId} />
      <ReviewButton messageId={conv.flaggedMessageId} reviewedAt={conv.reviewedAt} />
    </div>
  );
}
