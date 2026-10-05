import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { DbErrorFilter } from './common/errors/db-error.filter';
import { ValidationFailed } from './common/errors/domain-errors';
import { HttpErrorFilter } from './common/errors/http-error.filter';

const flatten = (errors: ValidationError[], parent = ''): { field: string; reason: string }[] =>
  errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((reason) => ({ field, reason }));
    return [...own, ...flatten(e.children ?? [], field)];
  });

// ใช้ร่วมกันระหว่าง main.ts กับ e2e — ถ้าตั้งค่าแยกสองที่ เทสจะผ่านบนแอปที่ไม่เหมือนของจริง
export const configureApp = (app: INestApplication): void => {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => new ValidationFailed(flatten(errors)),
    }),
  );
  // Nest เลือก filter ตัวท้ายก่อน: ตัวจับทุกอย่างต้องอยู่หน้า ไม่งั้น DbErrorFilter ไม่มีโอกาสทำงาน
  app.useGlobalFilters(new HttpErrorFilter(), new DbErrorFilter());
};
