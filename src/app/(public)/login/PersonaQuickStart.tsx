'use client';

import { useRouter } from 'next/navigation';
import { PERSONAS } from '@/demo/core/personas';
import { setPersona } from '@/demo/core/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

const GROUPS = ['Student', 'Staff', 'Platform'] as const;

/** Demo only: any credentials work, but this skips typing and jumps straight into a persona. */
export default function PersonaQuickStart() {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-tight">Quick start: pick a persona</h2>
        <CardDescription>This is a demo. Choose who you want to be and skip the login.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {GROUPS.map((g) => (
          <div key={g} className="grid gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</p>
            {PERSONAS.filter((p) => p.group === g).map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal px-4 py-2.5 text-left"
                onClick={() => {
                  setPersona(p.id);
                  router.push(p.home);
                }}
              >
                <span className="grid">
                  <span className="text-sm font-medium">{p.label} · {p.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{p.blurb}</span>
                </span>
              </Button>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
