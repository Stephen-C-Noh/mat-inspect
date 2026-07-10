import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// Wires Zod as Fastify's schema validator and serializer, matching core-api and audit. The
// upload route declares no request-body schema (the body is multipart binary, not JSON); the
// serializer still shapes the 201 response from mediaUploadResponseSchema.
export const setupZodValidation = <
  App extends FastifyInstance<any, any, any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  app: App,
): App => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  return app;
};
