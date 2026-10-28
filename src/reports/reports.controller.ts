import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { SalesReportQuery } from './reports.dto';
import { ReportsService } from './reports.service';

@Roles('admin')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Sotuv hisoboti: `?from=2026-10-01&to=2026-10-31&branchId=br_...` (filialsiz — butun tarmoq). */
  @Get('sales')
  sales(@Query() query: SalesReportQuery) {
    return this.reports.sales({ from: query.from, to: query.to, branchId: query.branchId || null });
  }

  /** Bosh sahifadagi "hozir" kartochkalari: jonli buyurtmalar, kam qolgan mahsulotlar, tasdiq kutayotgan kirimlar. */
  @Get('overview')
  overview() {
    return this.reports.overview();
  }
}
