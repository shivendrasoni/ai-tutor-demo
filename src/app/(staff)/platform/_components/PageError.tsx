import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import PlatformNav from './PlatformNav';

/** Page body for a failed lookup (bad query value, unknown id). */
export function pageError(title: string, e: unknown) {
  const message = e instanceof Error ? e.message : 'Something went wrong';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <PlatformNav />
      <Alert variant="destructive"><AlertCircle /><AlertDescription>{message}</AlertDescription></Alert>
    </div>
  );
}
