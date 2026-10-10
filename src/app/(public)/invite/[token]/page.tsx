import InviteFlow from './InviteFlow';

// The URL carries the invite token: never leak it through the Referer header.
export const metadata = { title: 'Set up your account · AI Tutor for Schools', referrer: 'no-referrer' as const };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteFlow token={token} />;
}
