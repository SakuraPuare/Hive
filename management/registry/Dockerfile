# syntax=docker/dockerfile:1
# Hive Node Registry — Go service (management plane)
# Build context: management/registry  (see homelab CI build-template `context` param)

# mirror.gcr.io: Google's pull-through Docker Hub cache (avoids CI rate limits)
FROM mirror.gcr.io/library/golang:1.25-alpine AS build
WORKDIR /src
# Cache modules first
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Static binary, no CGO — runs on distroless/static
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/hive-registry .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /
COPY --from=build /out/hive-registry /hive-registry
# In-cluster: listen on all interfaces (Ingress/Service front it, not localhost)
ENV LISTEN_ADDR=:8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/hive-registry"]
