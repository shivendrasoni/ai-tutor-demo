import { registerRoutes, clearRoutes } from './core/router';
import { authRoutes } from './core/auth';
import { coreSeed, CORE_KEY } from './core/seed-core';
import * as student from './areas/student';
import * as teacher from './areas/teacher';
import * as school from './areas/school';
import * as platform from './areas/platform';

export const seeds = {
  [CORE_KEY]: coreSeed,
  student: student.seed,
  teacher: teacher.seed,
  school: school.seed,
  platform: platform.seed,
};

export function registerAll() {
  clearRoutes();
  for (const r of [authRoutes, student.routes, teacher.routes, school.routes, platform.routes]) registerRoutes(r);
}
