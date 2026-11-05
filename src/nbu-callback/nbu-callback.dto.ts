export class NbuCallbackDto {
  transactionId: string;
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
  amount: number;            // tiyinda
  currency: number;          // 860 = UZS, 840 = USD
  purpose: string;
  clientId?: string | null;
  subscriptionId?: string | null;
  maskedPan?: string | null;
  createdAt?: string | null;
  paidAt?: string | null;
  errorCode?: number | null;
  clientData?: Record<string, any> | null;
  recipientAccount?: string | null;
}