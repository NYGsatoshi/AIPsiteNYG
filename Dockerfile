# syntax=docker/dockerfile:1.7

FROM node:24 AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN --mount=type=secret,id=syncfusion_license \
    set -eu; \
    if [ -x node_modules/.bin/syncfusion-license ]; then \
      test -s /run/secrets/syncfusion_license || { echo "SYNCFUSION_LICENSE is not configured." >&2; exit 1; }; \
      export SYNCFUSION_LICENSE="$(cat /run/secrets/syncfusion_license)"; \
      npm run syncfusion:activate; \
    else \
      echo "Syncfusion packages are not installed; skipping license activation."; \
    fi; \
    npm run build; \
    if [ -n "${SYNCFUSION_LICENSE:-}" ]; then \
      ! grep -R -F -q -- "$SYNCFUSION_LICENSE" dist || { echo "Syncfusion license material was found in frontend build output." >&2; exit 1; }; \
      unset SYNCFUSION_LICENSE; \
    fi

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY AipPortal.slnx ./
COPY src/AipPortal.Domain/AipPortal.Domain.csproj src/AipPortal.Domain/
COPY src/AipPortal.Application/AipPortal.Application.csproj src/AipPortal.Application/
COPY src/AipPortal.Infrastructure/AipPortal.Infrastructure.csproj src/AipPortal.Infrastructure/
COPY src/AipPortal.Web/AipPortal.Web.csproj src/AipPortal.Web/
RUN dotnet restore src/AipPortal.Web/AipPortal.Web.csproj

COPY . .
RUN rm -rf src/AipPortal.Web/wwwroot/*
COPY --from=frontend-build /src/frontend/dist/aipportal-web/ src/AipPortal.Web/wwwroot/
RUN dotnet publish src/AipPortal.Web/AipPortal.Web.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/storage/uploads
COPY --from=build /app/publish .
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec dotnet AipPortal.Web.dll --urls http://0.0.0.0:${PORT:-8080}"]
