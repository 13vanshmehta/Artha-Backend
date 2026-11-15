# ==============================================================================
# ARTHA BACKEND DOCKERFILE — MULTI-STAGE PRODUCTION BUILD
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package descriptors & prisma schema
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN pnpm run prisma:generate

# Copy TypeScript source and config
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src/

# Compile TypeScript to dist/
RUN pnpm run build

# Prune development dependencies for production runtime
RUN pnpm prune --prod

# ==============================================================================
# Stage 2: Minimal Production Image
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security: Run as unprivileged node user
USER node

# Copy compiled artifacts, pruned production node_modules, and generated prisma client
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

EXPOSE 3000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Production start with environment file support
CMD ["node", "--env-file=.env.production", "dist/main"]
