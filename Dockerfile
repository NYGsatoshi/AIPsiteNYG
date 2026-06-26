FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY AipPortal.slnx ./
COPY src/AipPortal.Domain/AipPortal.Domain.csproj src/AipPortal.Domain/
COPY src/AipPortal.Application/AipPortal.Application.csproj src/AipPortal.Application/
COPY src/AipPortal.Infrastructure/AipPortal.Infrastructure.csproj src/AipPortal.Infrastructure/
COPY src/AipPortal.Web/AipPortal.Web.csproj src/AipPortal.Web/
RUN dotnet restore src/AipPortal.Web/AipPortal.Web.csproj

COPY . .
RUN dotnet publish src/AipPortal.Web/AipPortal.Web.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/storage/uploads
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "AipPortal.Web.dll"]
