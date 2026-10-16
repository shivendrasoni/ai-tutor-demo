import { buildSeed } from './fixtures';
import { routes as handlers } from './handlers';
import type { Routes } from '../../core/router';

/** Seed slice for the student area (stored under key 'student'): conversations, study items and attempts keyed per student id. */
export const seed = buildSeed();
export const routes: Routes = handlers;
