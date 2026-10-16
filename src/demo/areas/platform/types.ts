/** Data shapes of the platform demo slice (JSON-safe: dates are ISO strings). */
export type PlanOption = { id: string; name: string; interval: 'monthly' | 'annual'; priceMinor: number; currency: string };

export type SchoolBranch = { id: string; name: string; signupCode: string; signupCodeEnabled: boolean };
export type SchoolListing = { id: string; name: string; board: string; branches: SchoolBranch[] };

export type PendingRow = {
  subscriptionId: string;
  status: 'pending_payment' | 'lapsed';
  studentName: string;
  username: string | null;
  schoolName: string;
  branchName: string;
  grade: number;
  parentName: string;
  parentPhone: string;
  planName: string;
  priceMinor: number;
  currency: string;
  createdAt: string;
  /** Core user activated when the payment is recorded (Greenfield students only). */
  userId?: string;
};

export type RecordedPayment = {
  id: string;
  subscriptionId: string;
  studentName: string;
  schoolName: string;
  planName: string;
  amountMinor: number;
  currency: string;
  externalRef: string | null;
  paidAt: string;
  periodEnd: string;
};

export type CostSummary = {
  bySchool: { schoolId: string; name: string; cost: number; tokens: number; students: number }[];
  bySkill: { skillKey: string; cost: number; tokens: number; turns: number }[];
  /** Demo extra: cost per model tier. */
  byTier?: { tier: string; model: string; cost: number; tokens: number; turns: number }[];
};

export type RoutingStats = {
  turns: number;
  advancedShare: number;
  offTopicBlocks: number;
  unsafeBlocks: number;
  filterFallbacks: number;
  deciderErrors: number;
  deciderFallbacks: number;
};

export type RoutingConfig = {
  basicModel: string;
  advancedModel: string;
  deciderModel: string;
  advancedMinGrade: number;
  advancedShareCapPct: number;
  offTopicFilter: boolean;
};

export type FlaggedRow = {
  messageId: string;
  conversationId: string;
  schoolName: string;
  studentName: string;
  reason: string | null;
  excerpt: string;
  createdAt: string;
};

export type MessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  flagReason?: string | null;
};

export type FlagRecord = FlaggedRow & { reviewedAt: string | null; messages: MessageRow[] };

export type InviteRecord = { studentName: string; schoolName: string; branchName: string; grade: number; used?: boolean };

export type PlatformSlice = {
  schools: SchoolListing[];
  plans: PlanOption[];
  pending: PendingRow[];
  payments: RecordedPayment[];
  costs: Record<'7' | '30', CostSummary>;
  routing: Record<'7' | '30', RoutingStats>;
  routingConfig: RoutingConfig;
  flags: FlagRecord[];
  invites: Record<string, InviteRecord>;
  /** Usernames already taken (join flow). */
  takenUsernames: string[];
  /** Subscription created by the latest demo signup/invite (drives /status for the pending persona). */
  signupSubscriptionId: string | null;
  signupName: string | null;
  /** Counter for generated ids. */
  counter: number;
};
