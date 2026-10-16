import { ApiError } from '../../core/router';
import { coreSeed } from '../../core/seed-core';
import type { CostSummary, FlaggedRow, MessageRow, PendingRow, PlatformSlice, RoutingStats, SchoolListing } from './types';

export const parseDays = (raw: string | null | undefined): 7 | 30 => {
  if (raw === undefined || raw === null || raw === '' || raw === '7') return 7;
  if (raw === '30') return 30;
  throw new ApiError(400, 'VALIDATION', 'days must be 7 or 30');
};

export const parseFlagStatus = (raw: string | null | undefined): 'open' | 'reviewed' => {
  if (raw === undefined || raw === null || raw === '' || raw === 'open') return 'open';
  if (raw === 'reviewed') return 'reviewed';
  throw new ApiError(400, 'VALIDATION', 'status must be open or reviewed');
};

export const selectSchools = (s: PlatformSlice): SchoolListing[] =>
  [...s.schools].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ ...x, branches: [...x.branches].sort((a, b) => a.name.localeCompare(b.name)) }));

export const selectPending = (s: PlatformSlice): PendingRow[] => [...s.pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const selectOverview = (s: PlatformSlice) => ({
  pendingPayments: s.pending.length,
  openFlags: s.flags.filter((f) => !f.reviewedAt).length,
  cost30d: s.costs['30'].bySchool.reduce((n, r) => n + r.cost, 0),
});

export function selectFlags(s: PlatformSlice, status: 'open' | 'reviewed'): FlaggedRow[] {
  return s.flags
    .filter((f) => (status === 'open' ? !f.reviewedAt : !!f.reviewedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ messages: _m, reviewedAt: _r, ...row }) => row);
}

export function selectFlagged(s: PlatformSlice, messageId: string): { messages: MessageRow[]; flaggedMessageId: string; reviewedAt: string | null } {
  const f = s.flags.find((x) => x.messageId === messageId);
  if (!f) throw new ApiError(404, 'NOT_FOUND', 'Flagged message not found');
  return { messages: f.messages, flaggedMessageId: f.messageId, reviewedAt: f.reviewedAt };
}

export const selectCosts = (s: PlatformSlice, days: 7 | 30): CostSummary => s.costs[String(days) as '7' | '30'];
export const selectRouting = (s: PlatformSlice, days: 7 | 30): RoutingStats => s.routing[String(days) as '7' | '30'];

export type Section = { id: string; grade: number; name: string };

/** Greenfield branches use the shared core sections; other branches get a generated set. */
export function sectionsForBranch(branchId: string): Section[] {
  const core = coreSeed.sections.filter((x) => x.branchId === branchId);
  if (core.length > 0) return core.map(({ id, grade, name }) => ({ id, grade, name }));
  return [6, 7, 8, 9, 10].map((g) => ({ id: `${branchId}-g${g}`, grade: g, name: `${g}-A` }));
}

export function findBranchByCode(s: PlatformSlice, code: string) {
  const c = code.trim().toUpperCase();
  for (const school of s.schools) {
    const branch = school.branches.find((b) => b.signupCode.toUpperCase() === c);
    if (branch) return { school, branch };
  }
  return null;
}
