import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Branch } from '../src/branches/branch.entity';
import { Warehouse } from '../src/branches/warehouse.entity';
import { Setting } from '../src/database/setting.entity';
import { Category } from '../src/menu/category.entity';
import { Product } from '../src/menu/product.entity';
import { CENTRAL_WAREHOUSE_NAME, FIRST_ADMIN, SetupService } from '../src/setup/setup.service';
import { User } from '../src/users/user.entity';
import { Ingredient } from '../src/warehouse/ingredient.entity';
import { StockItem } from '../src/warehouse/stock-item.entity';
import { seedDemo } from './fixtures/demo';
import { ADMIN_LOGIN, BRANCH_CHILONZOR as C } from './fixtures/demo-data';
import { createTestApp, truncateAll } from './test-app';

/**
 * Yangi baza (birinchi admin va markaziy ombor), admin kirishi (email va parol, PIN yo'li yopiq), "Profil" va
 * o'chirish qoidalari (faqat hech qayerda ishlatilmagan yozuv).
 */
describe('admin: yangi baza, kirish, profil, o\'chirish', () => {
  let app: INestApplication;
  let db: DataSource;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const adminToken = async (login: { email: string; password: string } = ADMIN_LOGIN) =>
    (await http().post('/api/auth/admin-login').send(login).expect(200)).body.token as string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(() => app.close());

  describe('yangi baza', () => {
    it("bo'sh bazada — bitta admin (Admin Adminov) va markaziy ombor; qayta ishga tushganda takrorlanmaydi", async () => {
      await truncateAll(app);
      const setup = app.get(SetupService);
      await setup.ensureBasics();
      await setup.ensureBasics();

      const users = await db.manager.find(User);
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        name: FIRST_ADMIN.name,
        surname: FIRST_ADMIN.surname,
        email: FIRST_ADMIN.email,
        role: 'admin',
        branchIds: [],
        active: true,
      });
      const warehouses = await db.manager.find(Warehouse);
      expect(warehouses).toEqual([expect.objectContaining({ name: CENTRAL_WAREHOUSE_NAME, kind: 'central', branchId: null })]);
      expect(await db.manager.count(Branch)).toBe(0);
      expect(await db.manager.count(Product)).toBe(0);

      const login = await http().post('/api/auth/admin-login').send({ email: 'Admin@Gmail.com', password: '123456789' }).expect(200);
      expect(login.body.user).toMatchObject({ name: 'Admin', surname: 'Adminov', role: 'admin', email: 'admin@gmail.com' });
      expect(login.body.shift).toBeNull();
    });

    it("ma'lumoti bor bazaga tegilmaydi: xodim bo'lsa admin qo'shilmaydi", async () => {
      await seedDemo(app, { activity: false });
      await app.get(SetupService).ensureBasics();
      expect(await db.manager.countBy(User, { role: 'admin' })).toBe(1);
      expect(await db.manager.countBy(Warehouse, { kind: 'central' })).toBe(1);
    });
  });

  describe('kirish', () => {
    beforeAll(() => seedDemo(app, { activity: false }));

    it("admin — faqat email va parol: PIN yo'li, ochiq ro'yxat va kassa qulfi unga yopiq", async () => {
      expect((await http().post('/api/auth/admin-login').send({ ...ADMIN_LOGIN, password: 'xato-parol' }).expect(401)).body.code).toBe(
        'wrong_login',
      );
      expect((await http().post('/api/auth/admin-login').send({ email: 'yoq@gmail.com', password: '123456789' }).expect(401)).body.code).toBe(
        'wrong_login',
      );
      // kuryer emaili admin kirishida — yo'q
      await http().post('/api/auth/admin-login').send({ email: 'bobur@gmail.com', password: 'bobur2222' }).expect(401);

      // PIN yo'li — parol PIN sifatida sinab ko'rilmaydi (rol oldin)
      const pin = await http().post('/api/auth/login').send({ userId: 'usr_admin', pin: '12345678' }).expect(403);
      expect(pin.body.code).toBe('forbidden');

      expect((await http().get('/api/auth/staff?role=admin').expect(200)).body).toEqual([]);
      const staff = (await http().get('/api/auth/staff').expect(200)).body as { role: string; surname: string }[];
      expect(staff.some((u) => u.role === 'admin' || u.role === 'courier')).toBe(false);
      expect(staff.every((u) => u.surname.length > 0)).toBe(true);

      const token = await adminToken();
      const me = await http().get('/api/auth/me').set(bearer(token)).expect(200);
      expect(me.body.user).toEqual({
        id: 'usr_admin',
        name: 'Admin',
        surname: 'Adminov',
        role: 'admin',
        branchId: null,
        branchIds: [],
        email: 'admin@gmail.com',
      });
      await http().post('/api/auth/unlock').set(bearer(token)).send({ pin: '1234' }).expect(403);
      await http().put('/api/auth/pin').set(bearer(token)).send({ oldPin: '1234', newPin: '4321' }).expect(403);
    });

    it("profil: ism, familiya, email; parol — joriysi bilan; boshqa rolga — 403", async () => {
      const token = await adminToken();
      const profile = (body: object) => http().put('/api/auth/profile').set(bearer(token)).send(body);

      expect((await profile({ name: 'Jamshid', surname: ' ', email: 'boss@gmail.com' }).expect(400)).body.code).toBe('surname_required');
      expect((await profile({ name: 'Jamshid', surname: 'Ergashev', email: 'boss' }).expect(400)).body.code).toBe('invalid_email');
      expect((await profile({ name: 'Jamshid', surname: 'Ergashev', email: 'Bobur@gmail.com' }).expect(409)).body.code).toBe(
        'email_taken',
      );
      const updated = await profile({ name: ' Jamshid ', surname: 'Ergashev', email: ' Boss@Gmail.com ' }).expect(200);
      expect(updated.body).toMatchObject({ id: 'usr_admin', name: 'Jamshid', surname: 'Ergashev', email: 'boss@gmail.com' });
      await http().post('/api/auth/admin-login').send(ADMIN_LOGIN).expect(401);
      await adminToken({ email: 'boss@gmail.com', password: ADMIN_LOGIN.password });

      const password = (body: object) => http().put('/api/auth/password').set(bearer(token)).send(body);
      expect((await password({ oldPassword: 'xato-parol', newPassword: 'yangi-parol' }).expect(401)).body.code).toBe('wrong_password');
      expect((await password({ oldPassword: ADMIN_LOGIN.password, newPassword: '1234567' }).expect(400)).body.code).toBe(
        'invalid_password',
      );
      await password({ oldPassword: ADMIN_LOGIN.password, newPassword: 'yangi-parol' }).expect(204);
      await adminToken({ email: 'boss@gmail.com', password: 'yangi-parol' });

      const cashier = (await http().post('/api/auth/login').send({ userId: 'usr_cashier_c1', pin: '1234' }).expect(200)).body.token;
      await http().put('/api/auth/profile').set(bearer(cashier)).send({ name: 'A', surname: 'B', email: 'a@b.uz' }).expect(403);
      await http().put('/api/auth/password').set(bearer(cashier)).send({ oldPassword: '1234', newPassword: '12345678' }).expect(403);
    });

    it("xodimlar: familiya majburiy; admin — email va parol bilan (PIN'siz), kassir — PIN bilan", async () => {
      await seedDemo(app, { activity: false });
      const token = await adminToken();
      const save = (body: object) => http().post('/api/users').set(bearer(token)).send(body);
      const base = { name: 'Nodira', role: 'admin', active: true };

      expect((await save({ ...base, email: 'nodira@gmail.com', password: 'nodira-123' }).expect(400)).body.code).toBe('surname_required');
      expect((await save({ ...base, surname: 'Aliyeva', pin: '1234' }).expect(400)).body.code).toBe('invalid_email');
      expect((await save({ ...base, surname: 'Aliyeva', email: 'nodira@gmail.com', pin: '1234' }).expect(400)).body.code).toBe(
        'invalid_password',
      );
      const nodira = await save({ ...base, surname: 'Aliyeva', email: 'Nodira@gmail.com', password: 'nodira-123' }).expect(201);
      expect(nodira.body).toMatchObject({ name: 'Nodira', surname: 'Aliyeva', email: 'nodira@gmail.com', role: 'admin' });
      expect(nodira.body.pinHash).toBeUndefined();
      await adminToken({ email: 'nodira@gmail.com', password: 'nodira-123' });

      const cashier = await save({ name: 'Olim', surname: 'Hasanov', role: 'cashier', branchIds: [C], pin: '2468', email: 'x@y.uz', active: true }).expect(201);
      expect(cashier.body).toMatchObject({ surname: 'Hasanov', email: null });
    });
  });

  describe("o'chirish — faqat hech qayerda ishlatilmagan bo'lsa", () => {
    let token: string;
    const del = (path: string) => http().delete(`/api/${path}`).set(bearer(token));
    const inUse = async (path: string, place: string) => {
      const res = await del(path).expect(409);
      expect(res.body).toMatchObject({ code: 'in_use', detail: place });
    };

    beforeAll(async () => {
      await seedDemo(app, { activity: true });
      token = await adminToken();
    });

    it('filial: tarixi bor — in_use; yangisi ombori bilan o\'chadi, zaxira va "sotilmaydi" ro\'yxatidan chiqadi', async () => {
      await inUse(`branches/${C}`, 'orders');
      const created = await http()
        .post('/api/branches')
        .set(bearer(token))
        .send({ name: 'Sergeli', address: '', phone: '', active: true })
        .expect(201);
      const id = created.body.id as string;
      await db.manager.update(Branch, { id: C }, { fallbackBranchId: id });
      await db.manager.query(`UPDATE products SET "unavailableBranchIds" = '["${id}"]'::jsonb WHERE id = 'burger-classic'`);
      const warehouse = await db.manager.findOneByOrFail(Warehouse, { branchId: id });
      await http().put(`/api/stock/${warehouse.id}/bun-burger/min-qty`).set(bearer(token)).send({ minQty: 5 }).expect(200);

      await del(`branches/${id}`).expect(204);
      expect(await db.manager.existsBy(Branch, { id })).toBe(false);
      expect(await db.manager.existsBy(Warehouse, { id: warehouse.id })).toBe(false);
      expect(await db.manager.existsBy(StockItem, { warehouseId: warehouse.id })).toBe(false);
      expect((await db.manager.findOneByOrFail(Branch, { id: C })).fallbackBranchId).toBeNull();
      expect((await db.manager.findOneByOrFail(Product, { id: 'burger-classic' })).unavailableBranchIds).toEqual([]);
      await del(`branches/${id}`).expect(404);

      // xodimi bor filial
      const withStaff = (
        await http().post('/api/branches').set(bearer(token)).send({ name: 'Olmazor', address: '', phone: '', active: true }).expect(201)
      ).body.id as string;
      await http()
        .post('/api/users')
        .set(bearer(token))
        .send({ name: 'Ra', surname: 'No', role: 'kitchen', branchIds: [withStaff], pin: '1357', active: true })
        .expect(201);
      await inUse(`branches/${withStaff}`, 'users');
    });

    it("kategoriya: taomi bor — in_use; bo'sh — o'chadi", async () => {
      await inUse('categories/burgers', 'products');
      const empty = await http()
        .post('/api/categories')
        .set(bearer(token))
        .send({ name: { uz: 'Salatlar', ru: '', en: '' }, image: '', icon: '', active: true })
        .expect(201);
      await del(`categories/${empty.body.id}`).expect(204);
      expect(await db.manager.existsBy(Category, { id: empty.body.id })).toBe(false);
    });

    it('taom: buyurtmada bor — in_use; hech qachon sotilmagani — o\'chadi', async () => {
      await inUse('products/burger-classic', 'orders');
      const fresh = await http()
        .post('/api/products')
        .set(bearer(token))
        .send({
          categoryId: 'burgers',
          name: { uz: 'Yangi burger', ru: '', en: '' },
          image: '',
          price: 30_000,
          recipe: [{ ingredientId: 'bun-burger', qty: 1 }],
          unavailableBranchIds: [],
          active: true,
        })
        .expect(201);
      await del(`products/${fresh.body.id}`).expect(204);
      expect(await db.manager.existsBy(Product, { id: fresh.body.id })).toBe(false);
    });

    it("ombor mahsuloti: retseptda — in_use; ishlatilmagani qoldiq yozuvlari bilan o'chadi", async () => {
      await inUse('ingredients/bun-burger', 'recipes');
      const fresh = await http()
        .post('/api/ingredients')
        .set(bearer(token))
        .send({ name: { uz: 'Kunjut', ru: '', en: '' }, group: 'other', unit: 'kg', active: true })
        .expect(201);
      await http().put(`/api/stock/wh_chilonzor/${fresh.body.id}/min-qty`).set(bearer(token)).send({ minQty: 100 }).expect(200);
      // norma — chegarani o'chirmaydi (va aksincha)
      const limits = await http()
        .put(`/api/stock/wh_chilonzor/${fresh.body.id}/target-qty`)
        .set(bearer(token))
        .send({ targetQty: 500 })
        .expect(200);
      expect(limits.body).toEqual({ warehouseId: 'wh_chilonzor', ingredientId: fresh.body.id, qty: 0, minQty: 100, targetQty: 500 });
      await http().put(`/api/stock/wh_chilonzor/${fresh.body.id}/min-qty`).set(bearer(token)).send({ minQty: 200 }).expect(200);
      expect(await db.manager.findOneByOrFail(StockItem, { warehouseId: 'wh_chilonzor', ingredientId: fresh.body.id })).toMatchObject({
        minQty: 200,
        targetQty: 500,
      });
      const bad = await http().put(`/api/stock/wh_chilonzor/${fresh.body.id}/target-qty`).set(bearer(token)).send({ targetQty: -1 }).expect(400);
      expect(bad.body.code).toBe('invalid_qty');
      await del(`ingredients/${fresh.body.id}`).expect(204);
      expect(await db.manager.existsBy(Ingredient, { id: fresh.body.id })).toBe(false);
      expect(await db.manager.existsBy(StockItem, { ingredientId: fresh.body.id })).toBe(false);
    });

    it("xodim: izi bor — in_use; o'zini — self_action; yangisi Telegram linki bilan o'chadi", async () => {
      await inUse('users/usr_cashier_c1', 'orders');
      expect((await del('users/usr_admin').expect(403)).body.code).toBe('self_action');
      const fresh = await http()
        .post('/api/users')
        .set(bearer(token))
        .send({ name: 'Vali', surname: 'Valiyev', role: 'supplier', pin: '8642', active: true })
        .expect(201);
      await db.manager.insert(Setting, { key: `telegram_link:${fresh.body.id}`, value: 'kod' });
      await del(`users/${fresh.body.id}`).expect(204);
      expect(await db.manager.existsBy(User, { id: fresh.body.id })).toBe(false);
      expect(await db.manager.existsBy(Setting, { key: `telegram_link:${fresh.body.id}` })).toBe(false);
      await del('users/yoq').expect(404);
    });

    it("faqat admin o'chiradi (ombor mahsulotini — ta'minotchi ham)", async () => {
      const supplier = (await http().post('/api/auth/login').send({ userId: 'usr_supplier', pin: '5555' }).expect(200)).body.token;
      await http().delete(`/api/branches/${C}`).set(bearer(supplier)).expect(403);
      await http().delete('/api/products/burger-classic').set(bearer(supplier)).expect(403);
      await http().delete('/api/users/usr_cashier_c1').set(bearer(supplier)).expect(403);
      const res = await http().delete('/api/ingredients/bun-burger').set(bearer(supplier)).expect(409);
      expect(res.body.code).toBe('in_use');
    });
  });
});
