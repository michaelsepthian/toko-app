.PHONY: run test test-unit test-integration test-cover vet fmt fmt-check build
run:
	go run ./cmd/api
test:
	go test -race ./...
test-unit:
	go test -race ./internal/... ./test/unit/... ./test/architecture/...
test-integration:
	@test -n "$$TEST_DATABASE_URL" || { echo "Isi TEST_DATABASE_URL dengan PostgreSQL lokal toko_test"; exit 1; }
	go test -race -count=1 ./test/integration/...
test-cover:
	go test -race -coverpkg=./internal/... -coverprofile=coverage.out ./...
vet:
	go vet ./...
fmt:
	gofmt -w cmd internal test
fmt-check:
	@test -z "$$(gofmt -l cmd internal test)" || { gofmt -l cmd internal test; exit 1; }
build:
	go build -o bin/toko-api ./cmd/api
