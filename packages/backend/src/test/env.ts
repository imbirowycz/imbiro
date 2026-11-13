// Preloaded by `npm test` (tsx --import): the minimum environment config.ts needs, so tests run
// without a local .env or a database. Nothing here connects anywhere — the pg pool is lazy.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/test'
process.env.ADMIN_USERNAME = 'admin'
process.env.ADMIN_EMAIL = 'admin@example.test'
// Placeholder with the right prefix; tests that log in replace it with a real hash.
process.env.ADMIN_PASSWORD_HASH = '$argon2id$placeholder'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.SESSION_COOKIE_SECURE = 'false'
process.env.TRUST_PROXY = '0'
