import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from './common/auth/jwt.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { Env, validateEnv } from './config/env';
import { dataSourceOptions } from './database/data-source';
import { AssetsController } from './modules/assets/assets.controller';
import { AssetsService } from './modules/assets/assets.service';
import { AuthModule } from './modules/auth/auth.module';
import { BuildingsController } from './modules/buildings/buildings.controller';
import { BuildingsService } from './modules/buildings/buildings.service';
import { HealthController } from './modules/health/health.controller';
import { RoomsController } from './modules/rooms/rooms.controller';
import { RoomsService } from './modules/rooms/rooms.service';
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
  ],
  controllers: [HealthController, UsersController, BuildingsController, RoomsController, AssetsController],
  providers: [
    UsersService,
    BuildingsService,
    RoomsService,
    AssetsService,
    // ลำดับสำคัญ: guard รันตามลำดับที่ลงทะเบียน — RolesGuard ต้องมาหลัง JwtAuthGuard เพราะอ่าน user ที่ guard นั้นโหลดไว้
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
