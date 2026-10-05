import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TechnicianNoRoom1759708800000 implements MigrationInterface {
  name = 'TechnicianNoRoom1759708800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(readFileSync(join(__dirname, '002_technician_no_room.sql'), 'utf8'));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_technician_no_room`);
  }
}
