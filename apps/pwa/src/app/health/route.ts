// Liveness endpoint for the container healthcheck probe (Dockerfile and docker-compose hit /health).
export const GET = () => Response.json({ status: 'ok' });
