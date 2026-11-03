import { Init1793059136458 } from './1793059136458-Init';
import { DropDevices1793080000000 } from './1793080000000-DropDevices';
import { Courier1793088593408 } from './1793088593408-Courier';
import { CourierLogin1793095767106 } from './1793095767106-CourierLogin';
import { SingleMenuPrice1793216335897 } from './1793216335897-SingleMenuPrice';
import { AiAssistant1793257582836 } from './1793257582836-AiAssistant';
import { ClearAiHistory1793265000000 } from './1793265000000-ClearAiHistory';
import { ReadyAtIndex1793595275423 } from './1793595275423-ReadyAtIndex';
import { CourierHistoryIndex1793600556217 } from './1793600556217-CourierHistoryIndex';
import { StaffEmailSurname1793630906349 } from './1793630906349-StaffEmailSurname';
import { OrderSyncedAt1793720000000 } from './1793720000000-OrderSyncedAt';

/** Barcha migratsiyalar tartib bilan. Yangisi `npm run migration:generate -- src/database/migrations/<Nom>` dan keyin shu yerga. */
export const MIGRATIONS: Function[] = [
  Init1793059136458,
  DropDevices1793080000000,
  Courier1793088593408,
  CourierLogin1793095767106,
  SingleMenuPrice1793216335897,
  AiAssistant1793257582836,
  ClearAiHistory1793265000000,
  ReadyAtIndex1793595275423,
  CourierHistoryIndex1793600556217,
  StaffEmailSurname1793630906349,
  OrderSyncedAt1793720000000,
];
