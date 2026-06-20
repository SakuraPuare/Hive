# syntax=docker/dockerfile:1
# Hive Node Registry — Go API server.
# Multi-stage: static build on golang, run on alpine (ca-certificates + tzdata
# needed because the MySQL DSN sets time_zone and the mailer talks TLS SMTP).

FROM golang:1.25-alpine AS build
WORKDIR /src

# Cache module downloads separately from source.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO disabled → fully static binary; -s -w strips debug info.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/hive-registry .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 10001 hive
WORKDIR /app
COPY --from=build /out/hive-registry /app/hive-registry
USER hive
EXPOSE 8080
ENTRYPOINT ["/app/hive-registry"]
