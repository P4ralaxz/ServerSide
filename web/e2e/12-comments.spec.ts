import { expect, test, type Page } from '@playwright/test';
import { newPage, shoot, type Variant } from './screens';
import { pickOnce, sessionFor, signIn, STAFF, studentOfRoom, technicianOf } from './support';

// ความเห็นในใบ (สัปดาห์ 6) — ช่องเขียนโผล่จาก actions · ความเห็นภายในนักศึกษาไม่เห็นและไม่มีสวิตช์
// mutation check:
//   API ไม่กรอง is_internal ให้นักศึกษา → เทสแรกแดง (นักศึกษาเห็นข้อความภายใน)
//   โชว์สวิตช์ความเห็นภายในให้ทุกคน → เทสแรกแดง

const INTERNAL = 'อะไหล่คอมเพรสเซอร์ราคา 1,200 บาท รออนุมัติ';
const PUBLIC = 'จะเข้าไปดูอีกครั้งพรุ่งนี้ช่วงบ่าย';
const REPLY = 'สะดวกครับ ไม่มีคนอยู่ห้องก็เข้าได้';

const comments = (page: Page) => page.getByRole('region', { name: 'ความเห็น' });

const write = async (page: Page, text: string, internal = false) => {
  const box = comments(page);
  await box.getByLabel('เขียนความเห็น').fill(text);
  if (internal) await box.getByRole('switch', { name: /ความเห็นภายใน/ }).click();
  await box.getByRole('button', { name: internal ? 'ส่งความเห็นภายใน' : 'ส่งความเห็น' }).click();
  await expect(page.getByRole('status')).toHaveText('ส่งความเห็นแล้ว');
  await expect(box.getByText(text)).toBeVisible();
};

test('ช่างเขียนความเห็นภายในและความเห็นถึงผู้พัก · นักศึกษาเห็นแค่ความเห็นปกติ ตอบกลับได้ · Staff เห็นครบ', async ({
  browser,
  request,
  baseURL,
}) => {
  const job = await pickOnce(request, 'comments', (all) =>
    all.find((t) => t.status === 'in_progress' && t.room_id !== null),
  );
  const tech = await technicianOf(request, job);
  const student = await studentOfRoom(request, job.room_id!);

  const techPage = await newPage(browser, baseURL!, { width: 360, height: 780, scheme: 'light' });
  await signIn(techPage, await sessionFor(request, tech.email));
  await techPage.goto(`/app/jobs/${job.id}`);
  // ส่งทั้งที่ช่องว่าง → บล็อกใต้ช่อง ไม่ยิง API
  await comments(techPage).getByRole('button', { name: 'ส่งความเห็น' }).click();
  await expect(comments(techPage).getByRole('alert')).toHaveText('พิมพ์ความเห็นก่อนส่ง');
  await write(techPage, INTERNAL, true);
  await write(techPage, PUBLIC);
  await expect(comments(techPage).getByRole('listitem').filter({ hasText: INTERNAL })).toContainText('ภายใน');
  await techPage.context().close();

  const studentPage = await newPage(browser, baseURL!, { width: 360, height: 780, scheme: 'light' });
  await signIn(studentPage, await sessionFor(request, student.email));
  await studentPage.goto(`/app/tickets/${job.id}`);
  await expect(comments(studentPage).getByText(PUBLIC)).toBeVisible();
  await expect(comments(studentPage).getByText(INTERNAL)).toHaveCount(0);
  await expect(comments(studentPage).getByRole('switch')).toHaveCount(0);
  await write(studentPage, REPLY);
  await expect(comments(studentPage).getByRole('listitem').filter({ hasText: REPLY })).toContainText('คุณ');
  await studentPage.context().close();

  const staffPage = await newPage(browser, baseURL!, { width: 1280, height: 860, scheme: 'light' });
  await signIn(staffPage, await sessionFor(request, STAFF));
  await staffPage.goto(`/app/queue?ticket=${job.id}`);
  await expect(comments(staffPage).getByRole('listitem')).toHaveText([
    new RegExp(INTERNAL),
    new RegExp(PUBLIC),
    new RegExp(REPLY),
  ]);
  await staffPage.context().close();
});

// screenshot หลังเทสข้างบน — ใบเดียวกันมีความเห็นครบทั้งสามแบบแล้ว
for (const v of [
  { width: 360, height: 780, scheme: 'light' },
  { width: 360, height: 780, scheme: 'dark' },
] as Variant[]) {
  test(`screenshot ความเห็นของช่าง ${v.width}px ${v.scheme}`, async ({ browser, request, baseURL }) => {
    const job = await pickOnce(request, 'comments', () => undefined);
    const tech = await technicianOf(request, job);
    const page = await newPage(browser, baseURL!, v, await sessionFor(request, tech.email));
    await page.goto(`/app/jobs/${job.id}`);
    await comments(page).scrollIntoViewIfNeeded();
    await expect(comments(page).getByText(REPLY)).toBeVisible();
    await shoot(page, '29-comments', v);
    await page.context().close();
  });
}
