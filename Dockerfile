# Multi-stage build for smaller production image
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Production image
FROM node:20-alpine

LABEL org.opencontainers.image.title="ChitChat Backend"
LABEL org.opencontainers.image.description="Temporary chat rooms with passphrases"

# Create non-root user for security
RUN addgroup -g 1001 -S chitchat && \
    adduser -S chitchat -u 1001 -G chitchat

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package*.json ./
COPY src/ ./src/
COPY public/ ./public/

# Set ownership
RUN chown -R chitchat:chitchat /app

USER chitchat

# Default environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/healthz" || exit 1'

CMD ["node", "src/server.js"]
