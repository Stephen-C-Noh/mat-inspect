import { createHmac } from 'crypto';

export const computeHmac = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('hex');

export const verifyHmac = (secret: string, payload: string, signature: string): boolean =>
  computeHmac(secret, payload) === signature;
