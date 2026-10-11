import { ShieldAlert } from 'lucide-react';

export default function NotAllowed() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-bold">Not allowed</h1>
      <p className="text-muted-foreground">Your account does not have access to this page.</p>
    </div>
  );
}
