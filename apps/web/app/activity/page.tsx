'use client';

import { LiveActivityList } from '@/components/wallet/live-activity-list';

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Transactions for this wallet, as the network reports them.
        </p>
      </div>
      <LiveActivityList />
    </div>
  );
}
