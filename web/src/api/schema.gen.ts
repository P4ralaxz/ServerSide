// ไฟล์นี้สร้างจาก Swagger ของ backend ด้วย `npm run web:types` — ห้ามแก้เอง
// test/contract/web-types.spec.ts เทียบไฟล์นี้กับ DTO ปัจจุบันทุกครั้งที่รัน test:e2e

export interface AssetDto {
  asset_code: string;
  name: string;
  category: string;
  building_id?: string;
  room_id?: string | null;
  location_note?: string | null;
}

export interface AssetListItemView {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  building_id: string;
  room_id: string | null;
  location_note: string | null;
  is_common_area: boolean;
  qr_token?: string;
  open_ticket: AssetOpenTicketView | null;
}

export interface AssetOpenTicketView {
  id: string;
  ticket_no: string;
  status: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
}

export interface AssetRefView {
  id: string;
  asset_code: string;
  name: string;
  category: string;
}

export interface AssetView {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  building_id: string;
  room_id: string | null;
  location_note: string | null;
  is_common_area: boolean;
  qr_token?: string;
}

export interface AssignTicketDto {
  technician_id: string;
}

export interface AutoCloseRunView {
  closed_count: number;
  tickets: AutoClosedTicket[];
}

export interface AutoClosedTicket {
  id: string;
  ticket_no: string;
  status: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  confirmed_by: string | null;
  close_reason: 'user_confirmed' | 'staff_confirmed' | 'auto_closed' | null;
}

export interface BuildingDto {
  code: string;
  name: string;
}

export interface BuildingRefView {
  id: string;
  name: string;
}

export interface BuildingView {
  id: string;
  code: string;
  name: string;
}

export interface ChangeStatusDto {
  to: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  note?: string;
}

export interface CommentAuthorView {
  id: string;
  name: string | null;
  role: 'student' | 'technician' | 'staff' | 'admin';
}

export interface CommentView {
  id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
  author: CommentAuthorView;
}

export interface CreateCommentDto {
  body: string;
  is_internal?: boolean;
}

export interface CreateTicketItemDto {
  asset_id: string;
  title: string;
  description: string;
  permission_to_enter?: boolean;
  scope?: 'room' | 'common_area';
  room_id?: string;
}

export interface CreateTicketsDto {
  items: CreateTicketItemDto[];
}

export interface CreateTicketsResponse {
  batch_id: string;
  created: TicketView[];
  skipped: SkippedItemView[];
}

export interface CreateUserDto {
  email: string;
  role?: 'student' | 'technician' | 'staff' | 'admin';
  full_name?: string | null;
  room_id?: string | null;
}

export interface HistoryEntryView {
  kind: 'status' | 'audit';
  at: string;
  actor: UserRefView | null;
  from_status?: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled' | null;
  to_status?: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  note?: string | null;
  duration_seconds?: number;
  action?: 'assign' | 'reassign' | 'schedule' | 'priority' | 'auto_escalate' | 'same_issue' | 'reopen';
  detail?: Record<string, unknown>;
}

export interface PatchAssetDto {
  asset_code?: string;
  name?: string;
  category?: string;
  building_id?: string;
  room_id?: string | null;
  location_note?: string | null;
}

export interface PatchBuildingDto {
  code?: string;
  name?: string;
}

export interface PatchRoomDto {
  building_id?: string;
  room_no?: string;
  floor?: number;
  capacity?: number;
}

export interface QueueCountsView {
  open_total: number;
  unassigned: number;
  urgent: number;
  disputed: number;
  reopened: number;
  common_pending_confirm: number;
}

export interface RejectTicketDto {
  note: string;
}

export interface ReopenTicketDto {
  note: string;
}

export interface ReportMetrics {
  total_tickets: number;
  open_tickets: number;
  closed_tickets: number;
  rejected_tickets: number;
  cancelled_tickets: number;
  user_confirmed: number;
  staff_confirmed: number;
  auto_closed: number;
  closed_while_disputed: number;
  reopened_tickets: number;
  reopen_total: number;
  median_repair_hours: number | null;
  avg_repair_hours: number | null;
  avg_confirm_hours: number | null;
  over_sla: number;
  overdue_open: number;
}

export interface RequestCodeDto {
  email: string;
}

export interface RequestCodeResponse {
  message: string;
}

export interface RoomDto {
  building_id: string;
  room_no: string;
  floor: number;
  capacity?: number;
}

export interface RoomRefView {
  id: string;
  room_no: string;
}

export interface RoomView {
  id: string;
  building_id: string;
  room_no: string;
  floor: number;
  capacity: number;
}

export interface ScanAssetView {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  location_note: string | null;
  building: BuildingRefView;
  room: RoomRefView | null;
}

export interface ScanOpenTicketView {
  id: string;
  ticket_no: string;
  status: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  updated_at: string;
  reported_by_me: boolean;
  actions: UiAction[];
}

export interface ScanView {
  asset: ScanAssetView;
  open_ticket: ScanOpenTicketView | null;
  can_report: boolean;
}

export interface ScheduleTicketDto {
  scheduled_at: string;
}

export interface SetPriorityDto {
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

export interface SkippedItemView {
  asset_id: string;
  ticket_no: string;
  ticket_id: string;
}

export interface SlaSummaryView {
  group_by: ('building' | 'category' | 'technician' | 'month')[];
  rows: SummaryRow[];
  total: ReportMetrics;
}

export interface StageDurationRow {
  stage: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  counted_in_sla: boolean;
  completed_count: number;
  avg_hours: number | null;
  median_hours: number | null;
  waiting_now: number;
  max_waiting_hours: number | null;
}

export interface SummaryRow {
  total_tickets: number;
  open_tickets: number;
  closed_tickets: number;
  rejected_tickets: number;
  cancelled_tickets: number;
  user_confirmed: number;
  staff_confirmed: number;
  auto_closed: number;
  closed_while_disputed: number;
  reopened_tickets: number;
  reopen_total: number;
  median_repair_hours: number | null;
  avg_repair_hours: number | null;
  avg_confirm_hours: number | null;
  over_sla: number;
  overdue_open: number;
  building?: BuildingRefView;
  category?: string;
  technician?: UserRefView | null;
  month?: string;
}

export interface TechnicianReportRow {
  technician: UserRefView;
  in_hand: number;
  resolved_total: number;
  closed_total: number;
  reopen_total: number;
  avg_hours_to_resolve: number | null;
  median_hours_to_resolve: number | null;
  median_sla_hours: number | null;
  late_resolved: number;
}

export interface TicketView {
  id: string;
  ticket_no: string;
  batch_id: string;
  asset_id: string;
  building_id: string;
  scope: 'room' | 'common_area';
  room_id: string | null;
  reporter_id: string;
  assigned_to: string | null;
  status: 'open' | 'assigned' | 'in_progress' | 'pending_parts' | 'resolved' | 'closed' | 'rejected' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  description: string | null;
  report_count: number;
  reopen_count: number;
  permission_to_enter: boolean;
  scheduled_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  confirmed_by: string | null;
  close_reason: 'user_confirmed' | 'staff_confirmed' | 'auto_closed' | null;
  disputed_at: string | null;
  created_at: string;
  updated_at: string;
  asset: AssetRefView;
  room: RoomRefView | null;
  building: BuildingRefView;
  assignee: UserRefView | null;
  last_reopen_note: string | null;
  waiting_for_parts: string | null;
  auto_close_at: string | null;
  actions: UiAction[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserView;
}

export type UiAction = 'cancel' | 'same_issue' | 'comment' | 'assign' | 'reject' | 'priority' | 'schedule' | 'start' | 'pending_parts' | 'resume' | 'resolve' | 'confirm' | 'reopen';

export interface UpdateUserDto {
  role?: 'student' | 'technician' | 'staff' | 'admin';
  is_active?: boolean;
  full_name?: string | null;
  room_id?: string | null;
}

export interface UserRefView {
  id: string;
  name: string | null;
}

export interface UserView {
  id: string;
  email: string;
  full_name: string | null;
  role: 'student' | 'technician' | 'staff' | 'admin';
  room_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VerifyCodeDto {
  email: string;
  code: string;
}
