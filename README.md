# Artha Backend

NestJS + Prisma + PostgreSQL API powering the Artha personal finance app. Authentication, session management, and account security are production-grade and implemented from scratch — this is not a starter template.

## 1. Architecture

```
React Native (frontend/)
        │  HTTPS + JWT bearer
        ▼
   NestJS API (this repo)
        │
        ▼
   Prisma ORM
        │
        ▼
   PostgreSQL (Aiven, TLS)
```

- **Framework**: NestJS 12, TypeScript, class-validator DTOs on every route.
- **ORM / DB**: Prisma Client against PostgreSQL (Aiven-hosted, `sslmode=require`).
- **Password/PIN hashing**: Argon2id (`src/auth/crypto.service.ts`).
- **Validation & errors**: global `ValidationPipe` + `AllExceptionsFilter` (`src/common/filters/`) returning a consistent `{ errorCode, message, details }` shape, with a correlation ID attached to every request/response and log line.
- **Email**: branded HTML/text transactional templates (`src/email/`), sent via SMTP (`EMAIL_PROVIDER=smtp`) or logged to a local outbox in dev (`local-outbox`, rejected if `NODE_ENV=production`).
- **In-memory infra (dev-stage only)**: `CacheService` and `QueueService` (`src/common/cache/`, `src/infrastructure/queue/`) are process-local stand-ins — not Redis/BullMQ. Fine for current single-instance scale; swap for Redis + BullMQ before running multiple API instances or relying on queued jobs.

## 2. Authentication & Session Model

- **Password/PIN storage**: Argon2id, never reversible, never logged.
- **Access tokens**: short-lived JWT (`JWT_ACCESS_TTL_SECONDS`, default 900s), signed with `JWT_SIGNING_SECRET`, scoped with `JWT_ISSUER` / `JWT_AUDIENCE`.
- **Sessions**: every login creates an `AuthSession` row (device name, platform, IP, user agent, `lastReauthenticatedAt`, `expiresAt`, revocation fields). Access tokens are validated against the live session, not just the JWT signature — a revoked session is immediately rejected even if the JWT hasn't expired yet.
- **Refresh tokens**: stored hashed (`RefreshToken.tokenHash`), rotated on every use (old token is consumed and linked via `replacedByTokenId`), grouped by `familyId`. Reusing an already-consumed refresh token is treated as compromise and revokes the whole token family.
- **OTP verification**: 6-digit codes, hashed at rest, rate-limited resend, bounded failed-attempt counter (`EmailVerificationChallenge`). Used for registration email verification and email-change verification.
- **OAuth**: Google (ID token verified server-side via `google-auth-library` against `GOOGLE_OAUTH_CLIENT_IDS`) and Apple (identity token verified against `APPLE_CLIENT_IDS`) sign-in, with identity linking/unlinking (`AuthIdentity`) separate from the primary email/password identity.
- **Re-authentication for sensitive actions**: a session tracks `lastReauthenticatedAt`. Changing password, changing email, or deleting the account all require either the current password inline or a recent call to `POST /auth/re-authenticate` (window: `REAUTH_WINDOW_SECONDS`).
- **Email change**: does **not** replace the email immediately. `POST /auth/email/change/request` (requires recent re-auth) sends an OTP to the *new* address; the old email stays active and verified until `POST /auth/email/change/confirm` validates the OTP. On success the change is atomic, a `SecurityEvent` is logged, every other session is revoked, and both the old and new addresses are notified.
- **Security event logging**: every sensitive action (login, logout, password/email change, OAuth link/unlink, session revocation, reauth failures, etc.) is recorded in `SecurityEvent` with IP/user agent/metadata for audit and abuse detection.

## 3. Environment Variables

See [`.env.example`](.env.example) for the full annotated list. Key groups:

| Group | Variables |
| :--- | :--- |
| Server | `NODE_ENV`, `PORT`, `CORS_ORIGINS` |
| Database | `DATABASE_URL`, `TEST_DATABASE_URL`, `DATABASE_CONNECTION_LIMIT`, `DATABASE_POOL_TIMEOUT_SECONDS`, `DATABASE_CONNECT_TIMEOUT_SECONDS`, `DATABASE_SSL_CA_PATH` |
| JWT / Sessions | `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_TTL_SECONDS`, `JWT_SIGNING_SECRET`, `REFRESH_TOKEN_TTL_DAYS`, `SESSION_ABSOLUTE_TTL_DAYS`, `REAUTH_WINDOW_SECONDS` |
| OTP / Password policy | `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS`, `PASSWORD_MIN_LENGTH`, `PASSWORD_RESET_TTL_MINUTES` |
| Email | `EMAIL_PROVIDER`, `EMAIL_FROM`, `APP_NAME`, `APP_URL`, `SUPPORT_EMAIL`, `EMAIL_LOGO_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `ARTHA_EMAIL_ID` / `ARTHA_EMAIL_APP_PASSWORD` (or `SMTP_USER` / `SMTP_PASS`) |
| OAuth | `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_IDS`, `APPLE_CLIENT_IDS` |

Copy `.env.example` to `.env.local` (used by `pnpm test` / `pnpm start:dev`) and fill in real values. **Never commit `.env`, `.env.local`, or `.env.production`.**

## 4. Database Setup

```bash
pnpm install

# generate Prisma client
pnpm prisma:generate

# apply migrations to DATABASE_URL
pnpm prisma:migrate:dev
```

The project targets a managed PostgreSQL instance (Aiven) over TLS. `docker-compose.yml` at the repo root is available for a local Postgres instance during development if you don't want to depend on a hosted DB.

## 5. API Endpoints

All routes are prefixed `/api/v1` (see `src/app.setup.ts`).

**Auth** (`/auth`)
| Method | Path | Notes |
| :--- | :--- | :--- |
| POST | `register` | Create account, triggers OTP email verification |
| POST | `email/verification/send` / `email/verification/confirm` | Registration OTP flow |
| POST | `login` | Email/password login |
| POST | `password/forgot` / `password/reset` | Password reset via emailed token |
| POST | `password/change` | Requires current password or recent re-auth |
| GET / PATCH | `me` | Profile |
| POST | `email/change/request` / `email/change/confirm` | OTP-verified email change (see §2); request requires recent re-auth |
| POST | `oauth/google` / `oauth/apple` | OAuth sign-in |
| POST | `oauth/link/google` / `oauth/link/apple` | Link identity to existing account |
| DELETE | `oauth/:provider` | Unlink identity |
| POST | `token/refresh` | Rotates refresh token |
| POST | `logout` / `logout-all` | Revoke current / all sessions |
| GET | `sessions` | List active sessions for the user |
| DELETE | `sessions/:sessionId` | Revoke one session |
| POST | `sessions/:sessionId/report-suspicious` | Flag + revoke a session as "this wasn't me" |
| POST | `sessions/revoke-others` / `sessions/logout-others` | Revoke every session but the current one |
| POST | `re-authenticate` | Re-confirm password/PIN to open the sensitive-action window |
| POST | `account/delete` | Requires recent re-auth |

**Security preferences** (`/users/me/security`) — GET/PATCH biometric, PIN, app-lock timeout, and reauth-requirement settings.

**Ledger / Personal Expense Tracker** (`/accounts`, `/categories`, `/transactions`, `/home`, `/summary`) — accounts, system + custom categories, the five transaction types (income, expense, transfer, refund, adjustment) with BIGINT minor-unit money, idempotent creates, soft delete, cursor pagination and timezone-aware analytics (`src/ledger/`). The API contract is [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

**Groups** (`/groups`) — collaborative groups and membership (`src/groups/`). Shared group expenses are not part of Phase 1.

**Health** — `GET /health`, `/health/live`, `/health/ready`.

Full request/response shapes are documented via Swagger (`@nestjs/swagger` decorators on every route) — run the app and check the configured docs path.

## 6. Testing

```bash
pnpm test        # unit tests (Jest)
pnpm test:cov     # unit tests with coverage
pnpm test:e2e     # e2e tests against TEST_DATABASE_URL (test/*.e2e-spec.ts)
```

`test/auth.e2e-spec.ts` covers the core auth/session lifecycle end-to-end against a real database schema. Known gap (see root README): no e2e coverage yet for delete-account, logout-all, revoke-other-sessions, or the email-change flow added in this pass.

## 7. Security Decisions Worth Knowing

- Access tokens are re-validated against the database session on every request — a revoked session is dead immediately, not just at JWT expiry.
- Refresh token reuse (replay of an already-rotated token) revokes the entire token family, not just that token.
- Changing email never silently takes over an account: the new address must prove ownership via OTP before anything changes, the old address stays valid until confirmation, and every other session is revoked once the change lands.
- `AuthChallenge` (model + `AuthChallengeType` enum) appears superseded by the dedicated `EmailVerificationChallenge` / `PasswordResetChallenge` models — flagged for removal pending a dependency check, not yet removed.
