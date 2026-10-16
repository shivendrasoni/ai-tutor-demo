'use client';

import { use } from 'react';
import ChatView from './ChatView';

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ChatView conversationId={id} />;
}
