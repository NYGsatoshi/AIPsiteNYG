FROM mcr.microsoft.com/dotnet/sdk:10.0.401@sha256:2fa828c68761b1b8c23d7662dc134421b9d3b59fe1425fdbc80804e390cdb24d

WORKDIR /workspace

ENV ASPNETCORE_ENVIRONMENT=Development \
    ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_USE_POLLING_FILE_WATCHER=true \
    DOTNET_WATCH_SUPPRESS_LAUNCH_BROWSER=true \
    NUGET_PACKAGES=/root/.nuget/packages \
    BACKEND_USE_WATCH=false

EXPOSE 8080

CMD ["bash", "-lc", "mkdir -p src/AipPortal.Web/wwwroot && dotnet tool restore && dotnet restore src/AipPortal.Web/AipPortal.Web.csproj /p:RestoreFallbackFolders= && dotnet ef database update --project src/AipPortal.Infrastructure --startup-project src/AipPortal.Web && if [ \"${BACKEND_USE_WATCH}\" = \"true\" ]; then dotnet watch --project src/AipPortal.Web/AipPortal.Web.csproj run --no-launch-profile; else dotnet run --project src/AipPortal.Web/AipPortal.Web.csproj --no-launch-profile; fi"]
