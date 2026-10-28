import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { isRealDateKey } from '../domain/dates';
import { CreateExpenseDto, ExpensesQuery } from './expense.dto';
import { Expense } from './expense.entity';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense) private readonly expenses: Repository<Expense>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
  ) {}

  findAll(query: ExpensesQuery) {
    for (const key of [query.from, query.to]) if (key && !isRealDateKey(key)) fail('invalid_input', `date ${key}`);
    const date =
      query.from && query.to
        ? Between(query.from, query.to)
        : query.from
          ? MoreThanOrEqual(query.from)
          : query.to
            ? LessThanOrEqual(query.to)
            : undefined;
    return this.expenses.find({
      where: { ...(query.branchId && { branchId: query.branchId }), ...(date && { date }) },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  /** Kommunal to'lov (svet, gaz, suv, internet...) — hisobotda tushumdan ayriladi. */
  async create(input: CreateExpenseDto, createdBy: string, now = new Date()): Promise<Expense> {
    if (!(await this.branches.existsBy({ id: input.branchId }))) fail('not_found', `branch ${input.branchId}`);
    if (!Number.isInteger(input.amount) || input.amount <= 0) fail('invalid_amount');
    if (!isRealDateKey(input.date)) fail('invalid_amount', 'date');
    const expense: Expense = {
      id: newId('exp'),
      branchId: input.branchId,
      kind: input.kind,
      amount: input.amount,
      date: input.date,
      note: input.note?.trim() ?? '',
      createdBy,
      createdAt: now,
    };
    await this.expenses.insert(expense);
    return expense;
  }

  async remove(id: string): Promise<Expense> {
    const expense = (await this.expenses.findOneBy({ id })) ?? fail('not_found', `expense ${id}`);
    await this.expenses.delete(id);
    return expense;
  }
}
