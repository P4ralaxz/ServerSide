import { Asset } from './asset.entity';
import { Building } from './building.entity';
import { LoginCode } from './login-code.entity';
import { Room } from './room.entity';
import { TicketAuditLog } from './ticket-audit-log.entity';
import { TicketComment } from './ticket-comment.entity';
import { TicketCounter } from './ticket-counter.entity';
import { TicketReporter } from './ticket-reporter.entity';
import { TicketStatusLog } from './ticket-status-log.entity';
import { Ticket } from './ticket.entity';
import { User } from './user.entity';

export { Asset, Building, LoginCode, Room, Ticket, TicketAuditLog, TicketComment, TicketCounter, TicketReporter };
export { TicketStatusLog, User };

// รายการเดียวที่ data-source ใช้ — contract test เทียบ entity ทุกตัวในนี้กับคอลัมน์จริงใน DB
export const ALL_ENTITIES = [
  Building,
  Room,
  User,
  LoginCode,
  Asset,
  TicketCounter,
  Ticket,
  TicketStatusLog,
  TicketAuditLog,
  TicketReporter,
  TicketComment,
];
