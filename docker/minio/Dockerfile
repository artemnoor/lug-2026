FROM golang:1.24-alpine AS build

ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z

RUN apk add --no-cache ca-certificates git

WORKDIR /src/minio
RUN git clone --depth 1 --branch "${MINIO_VERSION}" https://github.com/minio/minio.git . \
    && mkdir -p /out \
    && CGO_ENABLED=0 go build -trimpath -o /out/minio .

RUN git clone --depth 1 --branch "${MC_VERSION}" https://github.com/minio/mc.git /src/mc \
    && cd /src/mc \
    && CGO_ENABLED=0 go build -trimpath -o /out/mc .

FROM alpine:3.22

RUN apk add --no-cache ca-certificates wget \
    && addgroup -S minio \
    && adduser -S -G minio -h /home/minio minio \
    && mkdir -p /data \
    && chown minio:minio /data

COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/mc /usr/local/bin/mc

USER minio
VOLUME ["/data"]
ENTRYPOINT ["minio"]
