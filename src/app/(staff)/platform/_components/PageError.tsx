import { notFound } from 'next/navigation';
import NotAllowed from '../../_components/NotAllowed';
import PlatformNav from './PlatformNav';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DomainError } from '@/lib/errors';

/** Maps a loader error to a page body; unknown errors are rethrown. */
export function pageError(title: string, e: unknown) {
  if (e instanceof DomainError && e.code === 'FORBIDDEN') return <NotAllowed />;
  if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
  if (e instanceof DomainError && e.code === 'VALIDATION') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <PlatformNav />
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{e.message}</AlertDescription></Alert>
      </div>
    );
  }
  throw e;
}
