import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from './common/auth/jwt.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { Env, validateEnv } from './config/env';
import { dataSourceOptions } from './database/data-source';
import { AdminJobsController } from './modules/admin/admin-jobs.controller';
import { AssetsController } from './modules/assets/assets.controller';
import { AssetsService } from './modules/assets/assets.service';
import { AuthModule } from './modules/auth/auth.module';
import { BuildingsController } from './modules/buildings/buildings.controller';
import { BuildingsService } from './modules/buildings/buildings.service';
import { HealthController } from './modules/health/health.controller';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { RoomsController } from './modules/rooms/rooms.controller';
import { RoomsService } from './modules/rooms/rooms.service';
import { ScanController } from './modules/scan/scan.controller';
import { ScanService } from './modules/scan/scan.service';
import { AutoCloseJob } from './modules/tickets/auto-close.job';
import { TicketCreationService } from './modules/tickets/ticket-creation.service';
import { TicketPolicy } from './modules/tickets/ticket-policy.service';
import { TicketQueryService } from './modules/tickets/ticket-query.service';
import { TicketViewService } from './modules/tickets/ticket-view.service';
import { TicketWorkflowService } from './modules/tickets/ticket-workflow.service';
import { TicketsController } from './modules/tickets/tickets.controller';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => dataSourceOptions(config.get('DATABASE_URL', { infer: true })),
    }),
    // เพดานกันยิงถี่ทั่วทั้งระบบต่อ IP — ขีดจำกัดของ OTP อยู่ที่ OtpService (นับจาก DB) และ @Throttle บน verify-code
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuthModule,
    // job ปิดอัตโนมัติ (DESIGN 6.6) — เปิด/ปิดด้วย AUTO_CLOSE_CRON_ENABLED ที่ตัว job
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    UsersController,
    BuildingsController,
    RoomsController,
    AssetsController,
    TicketsController,
    ScanController,
    AdminJobsController,
    ReportsController,
  ],
  providers: [
    UsersService,
    BuildingsService,
    RoomsService,
    AssetsService,
    TicketPolicy,
    TicketViewService,
    TicketCreationService,
    TicketQueryService,
    TicketWorkflowService,
    ScanService,
    AutoCloseJob,
    ReportsService,
    // ลำดับสำคัญ: guard รันตามลำดับที่ลงทะเบียน — RolesGuard ต้องมาหลัง JwtAuthGuard เพราะอ่าน user ที่ guard นั้นโหลดไว้
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
