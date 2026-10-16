import { getPersona, setPersona } from './store';
import { PERSONAS, personaById } from './personas';
import { ApiError, type Routes } from './router';

/** Any credentials work. A username matching a demo user (or persona id) logs in as them; otherwise the current persona stays. */
export const authRoutes: Routes = {
  'POST /api/auth/login': ({ body }) => {
    const u = String(body?.username ?? '').trim().toLowerCase();
    if (!u) throw new ApiError(400, 'VALIDATION', 'Enter a username');
    const hit = PERSONAS.find((p) => p.id === u || p.name.toLowerCase().includes(u) || p.userId?.replace('u-', '') === u.split('.')[0]);
    if (hit) setPersona(hit.id);
    const p = personaById(getPersona());
    return { roles: [], isPlatformAdmin: p.id === 'platform_admin', home: p.home };
  },
  'POST /api/auth/logout': () => null,
};
