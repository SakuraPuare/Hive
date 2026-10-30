# syntax=docker/dockerfile:1
# Hive Registry UI — Next.js static export served by nginx
# Build context: management/registry-ui

FROM node:24.22.2-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@10 \
    && npm ci --prefer-offline --no-audit --no-fund
COPY . .
# next.config.js has output:'export' -> emits ./out
RUN npm run build

FROM nginx:1.31.8-alpine
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
