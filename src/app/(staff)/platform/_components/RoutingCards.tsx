import { Card, Stat } from '@/app/ui/components';
import type { RoutingStats } from '@/modules/analytics';

export default function RoutingCards({ stats }: { stats: RoutingStats }) {
  return (
    <Card title="Routing health">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Turns" value={stats.turns} />
        <Stat label="Advanced share" value={`${Math.round(stats.advancedShare * 100)}%`} />
        <Stat label="Off-topic blocks" value={stats.offTopicBlocks} />
        <Stat label="Unsafe blocks" value={stats.unsafeBlocks} />
        <Stat label="Filter fallbacks" value={stats.filterFallbacks} />
        <Stat label="Decider errors" value={stats.deciderErrors} />
        <Stat label="Decider fallbacks" value={stats.deciderFallbacks} />
      </div>
    </Card>
  );
}
