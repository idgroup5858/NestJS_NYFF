import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function pageParams(query: PageQuery, defaultLimit = 50): { page: number; limit: number; skip: number } {
  const page = query.page ?? 1;
  const limit = query.limit ?? defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
}
