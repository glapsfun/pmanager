IMAGE ?= ghcr.io/pm-example/webshop
TAG ?= dev

.PHONY: test lint image

test:
	go test ./...

lint:
	golangci-lint run

image:
	docker build -t $(IMAGE):$(TAG) .
