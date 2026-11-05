import { Injectable, Logger } from '@nestjs/common';
import { NbuCallbackDto } from './nbu-callback.dto';

@Injectable()
export class NbuCallbackService {
  private readonly logger = new Logger(NbuCallbackService.name);

  async process(dto: NbuCallbackDto): Promise<void> {
    this.logger.log(`tx=${dto.transactionId} order=${dto.orderId} status=${dto.status}`);

    switch (dto.status) {
      case 'SUCCESS':
        await this.onSuccess(dto);
        break;
      case 'FAILED':
        await this.onFailed(dto);
        break;
      case 'EXPIRED':
        // await this.ordersService.markExpired(dto.orderId);
        break;
      case 'REFUNDED':
        // await this.ordersService.markRefunded(dto.orderId);
        break;
    }
  }

  private async onSuccess(dto: NbuCallbackDto) {
    // const order = await this.ordersService.findById(dto.orderId);
    // if (order.status === 'PAID') return;   // takroriy callbackdan himoya
    // await this.ordersService.markPaid(dto.orderId, dto.paidAt);
  }

  private async onFailed(dto: NbuCallbackDto) {
    // await this.ordersService.markFailed(dto.orderId, dto.errorCode);
  }
}