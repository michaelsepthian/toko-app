.PHONY: run test vet fmt build
run:
	go run ./cmd/api
test:
	go test -race ./...
vet:
	go vet ./...
fmt:
	gofmt -w cmd internal
build:
	go build -o bin/toko-api ./cmd/api
