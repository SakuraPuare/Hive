BINARY  = hive-registry
GOOS   ?= linux
GOARCH ?= amd64

.PHONY: build tidy clean

build: tidy
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) \
	  go build -ldflags="-s -w" -o $(BINARY) .

# 交叉编译为 arm64（如果管理服务器是 ARM）
build-arm64:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
	  go build -ldflags="-s -w" -o $(BINARY)-arm64 .

tidy:
	go mod tidy

OPENAPI_DIR = openapi

openapi:
	@echo ">>> Generating OpenAPI spec ($(OPENAPI_DIR)/openapi.yaml)..."
	@rm -rf "$(OPENAPI_DIR)"
	# Use swaggo/swag via go run to avoid committing a separate binary.
	# It will generate swagger.yaml/json under $(OPENAPI_DIR) by default.
	go run github.com/swaggo/swag/cmd/swag@latest init \
		--generalInfo swagger.go \
		--parseDependency \
		--dir . \
		-o "$(OPENAPI_DIR)" \
		--parseDepth 100
	# Normalize output filename for downstream tools.
	cp "$(OPENAPI_DIR)/swagger.yaml" "$(OPENAPI_DIR)/openapi.yaml"

clean:
	rm -f $(BINARY) $(BINARY)-arm64
