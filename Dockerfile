# syntax=docker/dockerfile:1.7

FROM node:24 AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
COPY scripts/ci/verify-npm-lockfile.mjs /usr/local/lib/aipsite/verify-npm-lockfile.mjs
RUN --mount=type=cache,id=aipsite-docker-npm,target=/root/.npm,sharing=locked \
    npm install --global npm@11.17.0 \
      --ignore-scripts \
      --allow-git=none \
      --allow-remote=none \
      --no-audit \
      --no-fund
RUN node /usr/local/lib/aipsite/verify-npm-lockfile.mjs .
RUN --mount=type=cache,id=aipsite-docker-npm,target=/root/.npm,sharing=locked \
    npm ci \
      --prefer-online \
      --strict-allow-scripts \
      --allow-git=none \
      --allow-remote=none \
      --no-audit \
      --no-fund
COPY frontend/ ./
RUN --mount=type=secret,id=syncfusion_license,required=true \
    --mount=type=cache,id=aipsite-docker-angular,target=/src/frontend/.angular/cache,sharing=locked \
    set -eu; \
    test -x node_modules/.bin/syncfusion-license || { echo "Syncfusion License CLI is not installed." >&2; exit 1; }; \
    SYNCFUSION_LICENSE="$(tr -d '\r\n' < /run/secrets/syncfusion_license)"; \
    test -n "$SYNCFUSION_LICENSE" || { echo "SYNCFUSION_LICENSE is not configured." >&2; exit 1; }; \
    export SYNCFUSION_LICENSE; \
    npm run build:licensed; \
    ! grep -R -F -q -- "$SYNCFUSION_LICENSE" dist || { echo "Syncfusion license material was found in frontend build output." >&2; exit 1; }; \
    unset SYNCFUSION_LICENSE

FROM mcr.microsoft.com/dotnet/sdk:10.0.400 AS build
WORKDIR /src

COPY AipPortal.slnx ./
COPY src/AipPortal.Domain/AipPortal.Domain.csproj src/AipPortal.Domain/
COPY src/AipPortal.Application/AipPortal.Application.csproj src/AipPortal.Application/
COPY src/AipPortal.Infrastructure/AipPortal.Infrastructure.csproj src/AipPortal.Infrastructure/
COPY src/AipPortal.Web/AipPortal.Web.csproj src/AipPortal.Web/
RUN --mount=type=cache,id=aipsite-docker-nuget,target=/root/.nuget/packages,sharing=locked \
    dotnet restore src/AipPortal.Web/AipPortal.Web.csproj

COPY . .
RUN rm -rf src/AipPortal.Web/wwwroot/*
COPY --from=frontend-build /src/frontend/dist/aipportal-web/ src/AipPortal.Web/wwwroot/
# BuildKit cache mounts are mutable and can be pruned independently from cached
# restore layers. Force a restore in the same cache mount as publish so missing
# NuGet packages are repaired before --no-restore is used.
RUN --mount=type=cache,id=aipsite-docker-nuget,target=/root/.nuget/packages,sharing=locked \
    dotnet restore src/AipPortal.Web/AipPortal.Web.csproj --force && \
    dotnet publish src/AipPortal.Web/AipPortal.Web.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0.11 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/storage/uploads
COPY --from=build /app/publish .
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec dotnet AipPortal.Web.dll --urls http://0.0.0.0:${PORT:-8080}"]
