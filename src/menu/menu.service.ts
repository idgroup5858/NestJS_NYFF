import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { NON_COMPOSITION_GROUPS } from '../common/enums';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { assertUnused } from '../common/in-use';
import type { LocalizedText } from '../common/types';
import { Ingredient } from '../warehouse/ingredient.entity';
import { Category } from './category.entity';
import { SaveCategoryDto, SaveProductDto } from './menu.dto';
import { Product, soldAt } from './product.entity';

/** O'zbekcha nom majburiy; ruscha / inglizcha bo'sh qolsa ekranda o'zbekchasi ko'rinadi. */
function cleanName(name: LocalizedText): LocalizedText {
  const clean = { uz: name.uz.trim(), ru: name.ru.trim(), en: name.en.trim() };
  if (!clean.uz) fail('name_required');
  return clean;
}

/** Ochiq menyudagi taom: narxi bilan, retseptsiz (grammlar — ichki ma'lumot), tarkibi nomlar bilan. */
export interface MenuProduct {
  id: string;
  categoryId: string;
  name: LocalizedText;
  image: string;
  sortOrder: number;
  /** `null` — shu filialda vaqtincha sotilmaydi (faqat `all` rejimida keladi) */
  price: number | null;
  /** kioskda ko'rsatiladigan tarkib: retseptdagi mahsulotlar (qadoq, yog', ziravorlarsiz) */
  composition: LocalizedText[];
  /** `false` — oshxona chekiga chiqmaydi (tayyor ichimlik) */
  kitchen: boolean;
  /** `true` — truck chekiga chiqadi (`kitchen` dan mustaqil) */
  truck: boolean;
  /** `true` — faqat zalda beriladi (choynakdagi choy): olib ketish / dostavkaga yo'q, mobil ilova ko'rsatmaydi */
  dineInOnly: boolean;
}

@Injectable()
export class MenuService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  categories() {
    return this.dataSource.manager.find(Category, { order: { sortOrder: 'ASC' } });
  }

  products() {
    return this.dataSource.manager.find(Product, { order: { sortOrder: 'ASC' } });
  }

  /**
   * Kassa, kiosk va mobil ilova menyusi: faol kategoriyalar va shu filialda sotuvdagi taomlar (faol va filialda
   * "vaqtincha sotilmaydi" emas). Sotuvdagi taomi yo'q kategoriya chiqmaydi. [all] — kassa uchun: sotilmaydiganlari
   * ham (`price: null`) va hamma faol kategoriyalar.
   */
  async publicMenu(branchId: string, all = false) {
    const em = this.dataSource.manager;
    if (!(await em.existsBy(Branch, { id: branchId, active: true }))) fail('not_found', `branch ${branchId}`);
    const [categories, products, ingredients] = await Promise.all([
      em.find(Category, { where: { active: true }, order: { sortOrder: 'ASC' } }),
      em.find(Product, { where: { active: true }, order: { sortOrder: 'ASC' } }),
      em.find(Ingredient),
    ]);
    const ingredientOf = new Map(ingredients.map((i) => [i.id, i]));
    const activeCategories = new Set(categories.map((c) => c.id));

    const menu: MenuProduct[] = products.flatMap((product) => {
      const price = soldAt(product, branchId) ? product.price : null;
      if ((price === null && !all) || !activeCategories.has(product.categoryId)) return [];
      const composition = product.recipe.flatMap((line) => {
        const ingredient = ingredientOf.get(line.ingredientId);
        return ingredient && !NON_COMPOSITION_GROUPS.includes(ingredient.group) ? [ingredient.name] : [];
      });
      const { id, categoryId, name, image, sortOrder, kitchen, truck, dineInOnly } = product;
      return [{ id, categoryId, name, image, sortOrder, price, composition, kitchen, truck, dineInOnly }];
    });
    const withProducts = new Set(menu.map((p) => p.categoryId));
    return { branchId, categories: all ? categories : categories.filter((c) => withProducts.has(c.id)), products: menu };
  }

  async saveCategory(input: SaveCategoryDto & { id?: string }): Promise<Category> {
    const em = this.dataSource.manager;
    const fields = { name: cleanName(input.name), image: input.image.trim(), icon: input.icon.trim(), active: input.active };
    if (input.id) {
      await this.getCategory(em, input.id);
      await em.update(Category, input.id, fields);
      return this.getCategory(em, input.id);
    }
    const category: Category = { id: newId('cat'), ...fields, sortOrder: (await this.maxSortOrder(em, Category)) + 1 };
    await em.insert(Category, category);
    return category;
  }

  /**
   * Taom: narxi butun son > 0, retseptda kamida bitta mahsulot bo'lishi shart (sotuvda ombordan nima ayrilishi aniq
   * bo'lsin). Vaqtincha sotilmaydigan filiallar — mavjud filiallar (takrorlari olib tashlanadi).
   */
  async saveProduct(input: SaveProductDto & { id?: string }): Promise<Product> {
    const em = this.dataSource.manager;
    const name = cleanName(input.name);
    if (!Number.isInteger(input.price) || input.price <= 0) fail('invalid_price');
    await this.getCategory(em, input.categoryId);
    const unavailableBranchIds = [...new Set(input.unavailableBranchIds)];
    const branchIds = new Set((await em.findBy(Branch, { id: In(unavailableBranchIds) })).map((b) => b.id));
    for (const id of unavailableBranchIds) if (!branchIds.has(id)) fail('not_found', `branch ${id}`);
    const ingredientIds = new Set(
      (await em.findBy(Ingredient, { id: In(input.recipe.map((line) => line.ingredientId)) })).map((i) => i.id),
    );
    const merged = new Map<string, number>();
    for (const line of input.recipe) {
      if (!ingredientIds.has(line.ingredientId)) fail('not_found', `ingredient ${line.ingredientId}`);
      if (!Number.isInteger(line.qty) || line.qty < 1) fail('invalid_qty', line.ingredientId);
      merged.set(line.ingredientId, (merged.get(line.ingredientId) ?? 0) + line.qty);
    }
    if (merged.size === 0) fail('recipe_required');
    const recipe = [...merged].map(([ingredientId, qty]) => ({ ingredientId, qty }));
    const fields = {
      categoryId: input.categoryId,
      name,
      image: input.image.trim(),
      recipe,
      price: input.price,
      unavailableBranchIds,
      active: input.active,
    };

    if (input.id) {
      await this.getProduct(em, input.id);
      // berilmagan belgi o'zgarmaydi (eski admin paneli bilan saqlansa ham)
      await em.update(Product, input.id, {
        ...fields,
        ...(input.kitchen === undefined ? {} : { kitchen: input.kitchen }),
        ...(input.truck === undefined ? {} : { truck: input.truck }),
        ...(input.dineInOnly === undefined ? {} : { dineInOnly: input.dineInOnly }),
      });
      return this.getProduct(em, input.id);
    }
    const product: Product = {
      id: newId('prd'),
      ...fields,
      kitchen: input.kitchen ?? true,
      truck: input.truck ?? false,
      dineInOnly: input.dineInOnly ?? false,
      sortOrder: (await this.maxSortOrder(em, Product)) + 1,
    };
    await em.insert(Product, product);
    return product;
  }

  /** Kategoriyani o'chirish — ichida taom bo'lmasa (faol bo'lmaganlari ham sanaladi); aks holda `in_use`. */
  async removeCategory(id: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.getCategory(em, id);
      await assertUnused(em, id, { products: `SELECT 1 FROM products WHERE "categoryId" = $1 LIMIT 1` });
      await em.delete(Category, { id });
    });
  }

  /**
   * Taomni o'chirish — hech bir buyurtmada bo'lmasa (bekor qilinganlari ham); aks holda `in_use` — faolsizlantirish
   * kerak. Rasm fayli qoladi (galereyada boshqa taom / kategoriya ham ishlatishi mumkin).
   */
  async removeProduct(id: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await this.getProduct(em, id);
      await assertUnused(em, id, {
        orders: `SELECT 1 FROM orders WHERE items @> jsonb_build_array(jsonb_build_object('productId', $1::text)) LIMIT 1`,
      });
      await em.delete(Product, { id });
    });
  }

  /** Kategoriyani bir pog'ona yuqoriga (-1) yoki pastga (+1) — kassa va kioskda shu tartibda chiqadi. */
  async moveCategory(id: string, direction: -1 | 1): Promise<null> {
    return this.dataSource.transaction(async (em) => {
      await this.getCategory(em, id);
      const siblings = await em.find(Category, { order: { sortOrder: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      await this.swapSortOrder(em, Category, siblings, id, direction);
      return null;
    });
  }

  /** Taom faqat o'z kategoriyasi ichida suriladi. */
  async moveProduct(id: string, direction: -1 | 1): Promise<null> {
    return this.dataSource.transaction(async (em) => {
      const product = await this.getProduct(em, id);
      const siblings = await em.find(Product, {
        where: { categoryId: product.categoryId },
        order: { sortOrder: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      await this.swapSortOrder(em, Product, siblings, id, direction);
      return null;
    });
  }

  /** [siblings] (tartiblangan) ichida [id] ni qo'shnisi bilan almashtiradi; chetda bo'lsa o'zgarmaydi. */
  private async swapSortOrder<T extends Category | Product>(
    em: EntityManager,
    entity: typeof Category | typeof Product,
    siblings: T[],
    id: string,
    direction: -1 | 1,
  ): Promise<void> {
    const index = siblings.findIndex((item) => item.id === id);
    const target = siblings[index];
    const other = siblings[index + direction];
    if (!target || !other) return;
    await em.update(entity, target.id, { sortOrder: other.sortOrder });
    await em.update(entity, other.id, { sortOrder: target.sortOrder });
  }

  private async maxSortOrder(em: EntityManager, entity: typeof Category | typeof Product): Promise<number> {
    const row = await em.createQueryBuilder(entity, 'e').select('MAX(e.sortOrder)', 'max').getRawOne<{ max: number | null }>();
    return Math.max(0, row?.max ?? 0);
  }

  private async getCategory(em: EntityManager, id: string): Promise<Category> {
    return (await em.findOneBy(Category, { id })) ?? fail('not_found', `category ${id}`);
  }

  private async getProduct(em: EntityManager, id: string): Promise<Product> {
    return (await em.findOneBy(Product, { id })) ?? fail('not_found', `product ${id}`);
  }
}
