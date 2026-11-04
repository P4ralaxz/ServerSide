import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
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
export const configureApp = (app: INestApplication, opts: { trustProxy?: boolean } = {}): void => {
  // เชื่อ X-Forwarded-For เฉพาะ request ที่มาจากเครื่องนี้เอง (tunnel ที่รันบนเครื่องเดียวกัน)
  // ไม่ใช้ true: คนที่ต่อตรงจะปลอม header เพื่อหนีโควตาต่อ IP ได้ · 'loopback' ให้ header ถูกอ่านเฉพาะเมื่อ proxy เป็นตัวส่ง
  if (opts.trustProxy) (app as NestExpressApplication).set('trust proxy', 'loopback');
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
