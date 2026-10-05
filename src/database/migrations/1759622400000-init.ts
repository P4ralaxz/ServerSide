import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

// ตัวห่อบาง ๆ: โครงสร้างจริงอยู่ใน 001_init.sql ทั้งหมด
// ไม่เขียนเป็น queryRunner.createTable() เพราะ partial index / CHECK / trigger / view เขียนเป็น SQL ตรง ๆ อ่านง่ายและเทียบกับ DESIGN ได้
export class Init1759622400000 implements MigrationInterface {
  name = 'Init1759622400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(readFileSync(join(__dirname, '001_init.sql'), 'utf8'));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP VIEW IF EXISTS v_ticket_stage_durations;
      DROP TABLE IF EXISTS ticket_comments, ticket_reporters, ticket_audit_logs, ticket_status_logs,
                           tickets, ticket_counters, assets, login_codes, users, rooms, buildings;
      DROP FUNCTION IF EXISTS set_updated_at();
      DROP TYPE IF EXISTS audit_action, close_reason, ticket_priority, ticket_status, ticket_scope, user_role;
    `);
  }
}
