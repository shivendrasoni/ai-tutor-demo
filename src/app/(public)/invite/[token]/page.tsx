import InviteFlow from './InviteFlow';

export const metadata = { title: 'Set up your account · AI Tutor for Schools' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteFlow token={token} />;
}
