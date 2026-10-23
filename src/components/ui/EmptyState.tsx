import { Inbox } from 'lucide-react';
export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="text-center py-12 flex flex-col items-center gap-2">
      <div className="w-12 h-12 rounded-full bg-sf bd grid place-items-center tx-mu">
        {icon ?? <Inbox size={20} />}
      </div>
      <div className="font-semibold mt-1">{title}</div>
      {hint && <div className="tx-mu text-sm max-w-sm">{hint}</div>}
    </div>
  );
}
