# syntax=docker/dockerfile:1
# Hive Registry UI — Next.js static export served by nginx
# Build context: management/registry-ui

# mirror.gcr.io: Google's pull-through Docker Hub cache (avoids anonymous
# Docker Hub rate limits in CI). distroless/gcr images are unaffected.
FROM mirror.gcr.io/library/node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund
COPY . .
# next.config.js has output:'export' -> emits ./out
RUN npm run build

FROM mirror.gcr.io/library/nginx:1.27-alpine
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
