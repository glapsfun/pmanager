VERSION := 1.4.0
IMAGE := ghcr.io/pm-example/orders

.PHONY: test lint release

test:
	go test ./...

lint:
	go vet ./...

release:
	docker build -t $(IMAGE):$(VERSION) .
	docker push $(IMAGE):$(VERSION)
