import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

// Wires Zod as the request validator and response serializer for an app. Routes declare
// their `schema.body` / `schema.response` with Zod schemas from shared-schemas; Fastify
// validates input and serializes output through them. A response that does not match its
// declared schema fails serialization, so invalid data never reaches the client.
//
// Generic over the instance so it accepts a Fastify app with any server/logger generics
// (buildApp configures a custom pino loggerInstance). The `any` generics only widen the
// instance shape; the compilers themselves are schema-agnostic.
export const setupZodValidation = <
  App extends FastifyInstance<any, any, any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  app: App,
): App => {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  return app;
};
