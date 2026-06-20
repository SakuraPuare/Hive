# syntax=docker/dockerfile:1
# Hive Registry UI — Next.js 16 static export served by nginx.
# The generated API client (src/generated) is committed, so `next build`
# does NOT need gen-api / the registry OpenAPI spec at build time.
# API base defaults to /api (lib/openapi-session.ts) — same-origin via nginx.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# output: 'export' (next.config.js) → produces ./out
RUN npm run build

FROM nginx:1.27-alpine
# K8s-flavoured nginx: serves the static export and reverse-proxies /api/
# to the in-cluster registry Service.
COPY nginx.k8s.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
