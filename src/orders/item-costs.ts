import { EntityManager, In } from 'typeorm';
import { recipeCost } from '../domain/product-cost';
import { Product } from '../menu/product.entity';
import { Ingredient } from '../warehouse/ingredient.entity';

/**
 * Buyurtma qatorlarining 1 dona tannarxi (`Order.itemCosts`), qatorlar tartibida: taomning hozirgi retsepti × ombor
 * mahsulotlarining hozirgi oxirgi narxi (`lastPrice`). Sotuv paytida bir marta yoziladi — keyin narx o'zgarsa ham
 * o'tgan sotuvning tannarxi o'zgarmaydi. Taom yoki mahsulot topilmasa, birortasining narxi yo'q bo'lsa — `null`.
 * [products] — taomlar allaqachon o'qilgan bo'lsa.
 */
export async function orderItemCosts(
  em: EntityManager,
  items: { productId: string }[],
  products?: Map<string, Product>,
): Promise<(number | null)[]> {
  const menu =
    products ??
    new Map(
      (await em.findBy(Product, { id: In([...new Set(items.map((item) => item.productId))]) })).map((p) => [p.id, p]),
    );
  const ingredientIds = new Set<string>();
  for (const item of items) for (const line of menu.get(item.productId)?.recipe ?? []) ingredientIds.add(line.ingredientId);
  const ingredients =
    ingredientIds.size > 0
      ? new Map((await em.findBy(Ingredient, { id: In([...ingredientIds]) })).map((i) => [i.id, i]))
      : new Map<string, Ingredient>();
  return items.map((item) => {
    const product = menu.get(item.productId);
    return product ? recipeCost(product.recipe, ingredients) : null;
  });
}
