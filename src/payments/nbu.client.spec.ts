import { findPaymentUrl } from './nbu.client';

/** `payment/init` javobidan bank sahifasi havolasini topish — javob shakli hujjatdagidan farq qilishi mumkin. */
describe('findPaymentUrl', () => {
  const ours = {
    successUrl: 'https://fast.newyork24.uz/api/mobile/payments/return?result=success&id=1',
    failureUrl: 'https://fast.newyork24.uz/api/mobile/payments/return?result=failure&id=1',
  };

  it('haqiqiy javob (test sahifasi, 2026-11-18) — `data.url`', () => {
    const response = {
      status: { code: 0, message: 'OK' },
      data: {
        transactionId: '01a1edac-a0eb-7389-a306-73cc615ee889',
        url: 'https://ecom.nbu.uz/m/01a1edac-a0eb-7389-a306-73cc615ee889',
      },
      meta: { requestId: '01a1edac-97bb-7e8b-8224-e770eb3d276d', timestamp: 1794988876 },
    };
    expect(findPaymentUrl(response)).toBe('https://ecom.nbu.uz/m/01a1edac-a0eb-7389-a306-73cc615ee889');
  });

  it("hujjatdagidek — `data.paymentUrl`", () => {
    expect(findPaymentUrl({ status: { code: 0 }, data: { paymentUrl: 'https://ecom.nbu.uz/pay/1', ...ours } })).toBe(
      'https://ecom.nbu.uz/pay/1',
    );
  });

  it('boshqa nom, boshqa daraja, ichma-ich', () => {
    expect(findPaymentUrl({ status: { code: 0 }, paymentUrl: 'https://ecom.nbu.uz/a' })).toBe('https://ecom.nbu.uz/a');
    expect(findPaymentUrl({ data: { payment: { redirectURL: 'https://ecom.nbu.uz/b' } } })).toBe('https://ecom.nbu.uz/b');
    expect(findPaymentUrl({ data: { ...ours, checkoutLink: 'https://ecom.nbu.uz/c' } })).toBe('https://ecom.nbu.uz/c');
    expect(findPaymentUrl({ data: 'https://ecom.nbu.uz/d' })).toBe('https://ecom.nbu.uz/d');
    expect(findPaymentUrl({ result: [{ url: 'https://ecom.nbu.uz/e' }] })).toBe('https://ecom.nbu.uz/e');
  });

  it("qaytish manzillarimiz va havola bo'lmagan qiymatlar olinmaydi", () => {
    expect(findPaymentUrl({ data: { ...ours, transactionId: 'tx' } })).toBeNull();
    expect(findPaymentUrl({ data: { paymentUrl: '', url: 'emas-havola' } })).toBeNull();
    expect(findPaymentUrl('https://ecom.nbu.uz/root')).toBeNull();
    expect(findPaymentUrl(null)).toBeNull();
  });
});
