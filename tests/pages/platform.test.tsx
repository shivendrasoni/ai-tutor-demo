import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import {
  buildPaymentBody, loadCosts, loadFlagged, loadFlags, loadOverview, loadPayments, loadPlans, loadRouting, loadSchools,
  paymentFormDefaults,
} from '@/app/(staff)/platform/loaders';
import ConversationView from '@/app/(staff)/platform/_components/ConversationView';
import CostTables from '@/app/(staff)/platform/_components/CostTables';
import FlagsTable from '@/app/(staff)/platform/_components/FlagsTable';
import PaymentsTable from '@/app/(staff)/platform/_components/PaymentsTable';
import PlansList from '@/app/(staff)/platform/_components/PlansList';
import RoutingCards from '@/app/(staff)/platform/_components/RoutingCards';
import SchoolsList from '@/app/(staff)/platform/_components/SchoolsList';
import { insertMessage, seedAnalyticsWorld, type World } from '../helpers/analytics-seed';
import { resetDb } from '../helpers/db';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await seedAnalyticsWorld();
});
afterAll(closeDb);

const row = (o: Partial<Parameters<typeof paymentFormDefaults>[0]> = {}) => ({
  subscriptionId: 'sub-1', status: 'pending_payment', studentName: 'Riya', username: 'riya1', schoolName: 'School A',
  branchName: 'Branch A', grade: 8, parentName: 'Parent', parentPhone: '999', planName: 'Monthly', priceMinor: 49900,
  currency: 'INR', createdAt: new Date('2026-10-01T00:00:00Z'), ...o,
});
const form = { subscriptionId: 'sub-1', amount: '499.00', currency: 'INR', reference: '', paidAt: '2026-10-10' };

describe('payment form helpers', () => {
  it('paymentFormDefaults prefills the plan price in major units', () => {
    expect(paymentFormDefaults(row({ priceMinor: 49900, currency: 'INR' }))).toMatchObject({ amount: '499.00', currency: 'INR' });
    expect(paymentFormDefaults(row({ priceMinor: 5 })).amount).toBe('0.05');
    expect(paymentFormDefaults(row()).paidAt).toBe(new Date().toISOString().slice(0, 10));
  });
  it('buildPaymentBody lets the typed amount override the plan price exactly (Review Focus 3)', () => {
    expect(buildPaymentBody({ ...form, amount: '400' }).amountMinor).toBe(40000);
    expect(buildPaymentBody({ ...form, amount: '499.90' }).amountMinor).toBe(49990);
    expect(() => buildPaymentBody({ ...form, amount: '4.999' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => buildPaymentBody({ ...form, amount: '' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
  it('buildPaymentBody sends an ISO paidAt and omits a blank reference', () => {
    const b = buildPaymentBody(form);
    expect(b.paidAt).toBe('2026-10-10T00:00:00.000Z');
    expect(b.externalRef).toBeUndefined();
    expect(buildPaymentBody({ ...form, reference: ' UTR1 ' }).externalRef).toBe('UTR1');
    expect(() => buildPaymentBody({ ...form, paidAt: 'nope' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });
});

describe('loaders', () => {
  it('platform ok; non-platform FORBIDDEN; days=14 and status=bogus VALIDATION', async () => {
    expect((await loadOverview(w.platform, {})).openFlags).toBe(0);
    expect((await loadPayments(w.platform, {})).length).toBeGreaterThan(0);
    expect((await loadSchools(w.platform, {})).length).toBe(2);
    expect((await loadPlans(w.platform, {})).length).toBeGreaterThan(0);
    for (const f of [loadOverview, loadPayments, loadSchools, loadPlans]) {
      await expect(f(w.a.schoolAdmin, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(loadFlags(w.a.schoolAdmin, { status: 'open' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(loadCosts(w.a.schoolAdmin, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(loadRouting(w.a.branchAdmin, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(loadCosts(w.platform, { days: '14' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(loadRouting(w.platform, { days: 'x' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(loadFlags(w.platform, { status: 'bogus' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('loadCosts/loadRouting default to 7 days and pass 30 through', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 20 * 86_400_000);
    await insertMessage({ schoolId: w.a.schoolId, studentId: w.aActive1.userId, role: 'assistant', createdAt: old, decisions: { tier: 'advanced' } });
    expect((await loadRouting(w.platform, {})).turns).toBe(0);
    expect((await loadRouting(w.platform, { days: '7' })).turns).toBe(0);
    expect((await loadRouting(w.platform, { days: '30' })).turns).toBe(1);
    expect((await loadCosts(w.platform, {})).bySchool.length).toBe(2);
  });
  it('loadFlags defaults to open; loadFlagged returns the conversation', async () => {
    const id = await insertMessage({
      schoolId: w.a.schoolId, studentId: w.aActive1.userId, role: 'user', createdAt: new Date(), flagged: true, flagReason: 'self-harm',
    });
    const open = await loadFlags(w.platform, {});
    expect(open.map((r) => r.messageId)).toEqual([id]);
    expect(await loadFlags(w.platform, { status: 'reviewed' })).toEqual([]);
    const conv = await loadFlagged(w.platform, id);
    expect(conv.flaggedMessageId).toBe(id);
    await expect(loadFlagged(w.platform, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

const zeroStats = {
  turns: 0, advancedShare: 0, offTopicBlocks: 0, unsafeBlocks: 0, filterFallbacks: 0, deciderErrors: 0, deciderFallbacks: 0,
};

describe('components', () => {
  it('fresh platform with nothing in it renders every page component with its empty state (Review Focus 1)', () => {
    const html = renderToStaticMarkup(
      <>
        <PaymentsTable rows={[]} />
        <SchoolsList schools={[]} />
        <PlansList plans={[]} />
        <FlagsTable rows={[]} />
        <CostTables data={{ bySchool: [], bySkill: [] }} />
        <RoutingCards stats={zeroStats} />
      </>,
    );
    expect(html).toContain('No pending payments');
    expect(html).toContain('No schools yet');
    expect(html).toContain('No plans yet');
    expect(html).toContain('No flagged conversations');
    expect(html).not.toContain('NaN');
  });
  it('PaymentsTable renders a prefilled amount form per row', () => {
    const html = renderToStaticMarkup(<PaymentsTable rows={[row()]} />);
    for (const s of ['Riya', 'School A', 'Monthly', '₹499.00', 'value="499.00"', 'Record payment']) expect(html).toContain(s);
  });
  it('RoutingCards shows advancedShare as a percentage and all seven stats', () => {
    const html = renderToStaticMarkup(
      <RoutingCards stats={{ turns: 40, advancedShare: 0.256, offTopicBlocks: 3, unsafeBlocks: 2, filterFallbacks: 4, deciderErrors: 5, deciderFallbacks: 6 }} />,
    );
    for (const s of ['26%', '40', 'Off-topic', 'Unsafe', 'Filter fallbacks', 'Decider errors', 'Decider fallbacks']) expect(html).toContain(s);
  });
  const msg = (id: string, role: 'user' | 'assistant', content: string) => ({
    id, conversationId: 'c', role, content, citations: [], retrievedChunkIds: [], decisions: null, model: null, modelTier: null,
    tokensIn: 0, tokensOut: 0, cost: null, latencyMs: null, flagged: id === 'm2', flagReason: null, feedback: null, createdAt: new Date(),
  });
  it('ConversationView highlights only the flagged message, shows roles, and escapes content', () => {
    const html = renderToStaticMarkup(
      <ConversationView
        flaggedMessageId="m2"
        messages={[msg('m1', 'user', 'hi'), msg('m2', 'assistant', '<img src=x onerror=alert(1)>'), msg('m3', 'user', 'bye')]}
      />,
    );
    expect(html.match(/data-flagged="true"/g)).toHaveLength(1);
    expect(html).toContain('Student');
    expect(html).toContain('Tutor');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('SchoolsList shows branches with signup codes and "No branches yet" for a school without them', () => {
    const html = renderToStaticMarkup(
      <SchoolsList
        schools={[
          { id: 's1', name: 'Alpha', board: 'CBSE', branches: [{ id: 'b1', name: 'North', signupCode: 'ABC123', signupCodeEnabled: true }] },
          { id: 's2', name: 'Beta', board: 'ICSE', branches: [] },
        ]}
      />,
    );
    for (const s of ['Alpha', 'North', 'ABC123', 'Beta', 'No branches yet']) expect(html).toContain(s);
  });
});

describe('flag review state', () => {
  it('ReviewButton shows the reviewed date and no button when already reviewed', async () => {
    const { default: ReviewButton } = await import('@/app/(staff)/platform/_components/ReviewButton');
    const done = renderToStaticMarkup(<ReviewButton messageId="m1" reviewedAt={new Date('2026-10-05T10:00:00Z')} />);
    expect(done).toContain('Reviewed on 2026-10-05');
    expect(done).not.toContain('<button');
    const open = renderToStaticMarkup(<ReviewButton messageId="m1" reviewedAt={null} />);
    expect(open).toContain('Mark reviewed');
  });
});

describe('PlatformNav', () => {
  it('links to content items', async () => {
    const { default: PlatformNav } = await import('@/app/(staff)/platform/_components/PlatformNav');
    expect(renderToStaticMarkup(<PlatformNav />)).toContain('href="/school/content"');
  });
});
