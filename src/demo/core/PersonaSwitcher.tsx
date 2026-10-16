'use client';
import { RotateCcw, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PERSONAS, personaById, type PersonaId } from './personas';
import { resetStore, setPersona, usePersona } from './store';

const GROUPS = ['Student', 'Staff', 'Platform'] as const;

/** Floating control to switch who you're viewing the app as, and to reset the demo data. */
export default function PersonaSwitcher() {
  const router = useRouter();
  const current = usePersona();
  const [open, setOpen] = useState(false);

  function pick(id: PersonaId) {
    setPersona(id);
    setOpen(false);
    router.push(personaById(id).home);
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2" data-testid="persona-switcher">
      {open ? (
        <div className="w-72 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl" role="menu" aria-label="Switch persona">
          {GROUPS.map((g) => (
            <div key={g} className="mb-2 last:mb-0">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
              {PERSONAS.filter((p) => p.group === g).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.id === current}
                  data-persona={p.id}
                  onClick={() => pick(p.id)}
                  className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent ${p.id === current ? 'bg-accent font-medium' : ''}`}
                >
                  <span>{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.name} · {p.blurb}</span>
                </button>
              ))}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              resetStore();
              toast.success('Demo data reset');
            }}
          >
            <RotateCcw className="size-4" /> Reset demo data
          </Button>
        </div>
      ) : null}
      <Button type="button" size="lg" className="rounded-full shadow-lg" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Users className="size-4" /> Viewing as: {personaById(current).label}
      </Button>
    </div>
  );
}
