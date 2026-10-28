import { Branch } from '../branches/branch.entity';
import { Warehouse } from '../branches/warehouse.entity';
import { Expense } from '../expenses/expense.entity';
import { Category } from '../menu/category.entity';
import { Product } from '../menu/product.entity';
import { Order } from '../orders/order.entity';
import { Shift } from '../shifts/shift.entity';
import { User } from '../users/user.entity';
import { Ingredient } from '../warehouse/ingredient.entity';
import { Purchase } from '../warehouse/purchase.entity';
import { StockItem } from '../warehouse/stock-item.entity';
import { StockMovement } from '../warehouse/stock-movement.entity';
import { Transfer } from '../warehouse/transfer.entity';
import { Counter } from './counters';
import { Setting } from './setting.entity';

export const ENTITIES = [
  Setting,
  Counter,
  Branch,
  Warehouse,
  User,
  Category,
  Product,
  Ingredient,
  StockItem,
  StockMovement,
  Purchase,
  Transfer,
  Shift,
  Order,
  Expense,
];
