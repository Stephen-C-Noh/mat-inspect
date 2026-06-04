import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: '../../db/schema/*.ts',
  out: '../../db/migrations',
  dbCredentials: {
    // CORE_API_DB_URL uses the Docker internal hostname; replace it with localhost
    // when drizzle-kit runs outside the container (local dev, CI migration step).
    // drizzle-kit generate only reads schema files and never connects; the URL
    // is required by the config shape but unused during generate. db:migrate and
    // db:push require a real value supplied via DATABASE_URL or CORE_API_DB_URL.
    url:
      process.env['DATABASE_URL'] ??
      process.env['CORE_API_DB_URL']?.replace('@postgres:', '@localhost:') ??
      'postgresql://localhost/unused',
  },
});
