# Build stage
FROM node:22.13.1-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /workspace

# Copy workspace configuration (build from workspace root)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Copy cachebay package
COPY packages/cachebay ./packages/cachebay/

# Copy demo package
COPY packages/demo ./packages/demo-vue/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder

WORKDIR /workspace/packages/demo-vue

# Build the application
RUN pnpm build

# Production stage
FROM node:22.13.1-alpine AS production

# Add service label for Kamal deployment
LABEL service=harrypotter

WORKDIR /app

# Copy built application
COPY --from=builder /workspace/packages/demo-vue/.output ./nuxt

# Copy vendor database files as read-only templates
COPY --from=builder /workspace/packages/demo-vue/vendor ./vendor

# Copy database management script
COPY --from=builder /workspace/packages/demo-vue/bin/reset-db /app/reset-db
RUN chmod +x /app/reset-db

# Expose the port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

# Start the application with database setup
CMD ["/bin/sh", "-c", "/app/reset-db && node nuxt/server/index.mjs"]
