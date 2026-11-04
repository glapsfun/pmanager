FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /webshop .

FROM gcr.io/distroless/static
COPY --from=build /webshop /webshop
EXPOSE 8080
ENTRYPOINT ["/webshop"]
