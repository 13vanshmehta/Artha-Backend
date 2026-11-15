/**
 * Runs before any e2e test module is imported (jest `setupFiles`).
 *
 * AppModule reads NODE_ENV and loads its .env files at import time, so these
 * values must be in place before `import { AppModule }` executes — setting them
 * inside `beforeAll` is too late. With NODE_ENV=test, ConfigModule does not let
 * .env.local override them, the database resolves to TEST_DATABASE_URL only, and
 * MailService never opens a real SMTP connection.
 */
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'local-outbox';
process.env.GOOGLE_OAUTH_CLIENT_IDS = 'test-google-client-id';
process.env.APPLE_CLIENT_IDS = 'com.artha.app';
