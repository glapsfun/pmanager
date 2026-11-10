FROM golang:1.22 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /orders ./cmd/orders

FROM gcr.io/distroless/static
COPY --from=build /orders /orders
ENTRYPOINT ["/orders"]
