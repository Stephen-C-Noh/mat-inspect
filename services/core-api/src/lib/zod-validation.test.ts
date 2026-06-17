import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { equipmentSchema } from '@mat-inspect/shared-schemas';
import { setupZodValidation } from './zod-validation.js';

const validEquipment = {
  id: '11111111-1111-1111-1111-111111111111',
  assetTag: 'CRANE-01',
  name: 'Overhead Crane 1',
  type: 'OVERHEAD_CRANE' as const,
  make: 'Konecranes',
  model: 'CXT',
  serialNumber: 'SN-123',
  location: 'Bay 4',
  status: 'READY' as const,
  currentStatusSince: '2026-06-10T12:00:00.000Z',
  manufacturerSpecsUrl: null,
  createdAt: '2026-06-01T09:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
};

const buildTestApp = async (handler: () => unknown) => {
  const app = Fastify();
  setupZodValidation(app);
  app.get('/equipment', { schema: { response: { 200: z.array(equipmentSchema) } } }, handler);
  await app.ready();
  return app;
};

describe('setupZodValidation', () => {
  it('serializes a response that conforms to the Zod schema', async () => {
    const app = await buildTestApp(() => [validEquipment]);

    const res = await app.inject({ method: 'GET', url: '/equipment' });

    expect(res.statusCode).toBe(200);
    const body = z.array(equipmentSchema).parse(res.json());
    expect(body).toEqual([validEquipment]);
  });

  it('fails the response instead of leaking data that violates the schema', async () => {
    // status is not a member of equipmentStatusSchema: the row must never reach the client.
    const invalid = { ...validEquipment, status: 'TOTALLY_NOT_A_STATUS' };
    const app = await buildTestApp(() => [invalid]);

    const res = await app.inject({ method: 'GET', url: '/equipment' });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('TOTALLY_NOT_A_STATUS');
  });

  it('returns the list when manufacturerSpecsUrl holds a non-URL string (DEV-54)', async () => {
    // The DB column manufacturer_specs_url is free text with no URL constraint. A single
    // legacy or hand-entered non-URL value must not 500 the whole equipment list.
    const legacy = { ...validEquipment, manufacturerSpecsUrl: 'see binder in Bay 4 cabinet' };
    const app = await buildTestApp(() => [legacy]);

    const res = await app.inject({ method: 'GET', url: '/equipment' });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0].manufacturerSpecsUrl).toBe('see binder in Bay 4 cabinet');
  });

  it('strips fields that are not part of the schema', async () => {
    const withExtra = { ...validEquipment, internalSecretColumn: 'do-not-leak' };
    const app = await buildTestApp(() => [withExtra]);

    const res = await app.inject({ method: 'GET', url: '/equipment' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('internalSecretColumn');
    expect(res.json()[0]).not.toHaveProperty('internalSecretColumn');
  });
});
