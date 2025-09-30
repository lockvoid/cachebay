# Build stage
FROM node:22.13.1-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /workspace

# Copy workspace configuration (build from workspace root)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Copy villus-cachebay package
COPY packages/villus-cachebay ./packages/villus-cachebay/

# Copy demo package
COPY packages/demo ./packages/demo/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder

WORKDIR /workspace/packages/demo

# Build the application
RUN pnpm build

# Production stage
FROM node:22.13.1-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=builder /workspace/packages/demo/.output ./.output

# Expose the port
EXPOSE 3000

# Set environment variables 
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

# Start the application
CMD ["node", ".output/server/index.mjs"]
