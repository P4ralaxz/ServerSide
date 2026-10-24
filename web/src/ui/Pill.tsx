import { statusLabel, statusTone, type TicketStatus } from './status';

export function Pill({ status }: { status: TicketStatus }) {
  return <span className={`pill ${statusTone(status)}`}>{statusLabel(status)}</span>;
}
