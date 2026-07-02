import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

export const setupZodValidation = <
  App extends FastifyInstance<any, any, any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  app: App,
): App => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  return app;
};
