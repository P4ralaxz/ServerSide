import { priorityLabel, priorityTone, type TicketPriority } from './status';

export function Priority({ priority }: { priority: TicketPriority }) {
  return <span className={`prio ${priorityTone(priority)}`}>{priorityLabel(priority)}</span>;
}
