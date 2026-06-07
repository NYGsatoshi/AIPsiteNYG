import { PlatformAdminApi, TenantAdminApi, TenantApi } from "../api.js";
import { enumLabel } from "../enums.js";
import { badge, emptyState, errorState, escapeHtml, loadingState, pageTitle } from "../utils.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function ratio(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function quotaRow(label, used, limit, usedLabel = used, limitLabel = limit) {
  const percent = ratio(used, limit);
  const tone = percent >= 95 ? "is-danger" : percent >= 80 ? "is-hot" : "";
  return `
    <div class="quota-row ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(percent))}%</strong>
      <progress max="100" value="${percent}"></progress>
      <small>${escapeHtml(String(usedLabel))} / ${escapeHtml(String(limitLabel))}</small>
    </div>
  `;
}

function tenantStatePanel(currentTenant) {
  if (!currentTenant) {
    return errorState("Tenant unavailable.");
  }

  const status = enumLabel("tenantStatus", currentTenant.status);
  const role = currentTenant.currentUserRole == null ? "No tenant role" : enumLabel("tenantUserRole", currentTenant.currentUserRole);
  const restricted = currentTenant.status === 1 || currentTenant.status === "Suspended" || currentTenant.status === 2 || currentTenant.status === "Archived";
  return `
    <section class="panel ${restricted ? "state-warning" : ""}">
      <div class="section-heading">
        <h2>${escapeHtml(currentTenant.displayName || currentTenant.tenantSlug || "Current tenant")}</h2>
        ${badge(status, restricted ? "is-hot" : "")}
      </div>
      <p>${escapeHtml(role)}</p>
      ${restricted ? `<p class="form-message">Tenant status is ${escapeHtml(status)}. Backend policy may reject normal writes.</p>` : ""}
    </section>
  `;
}

export async function renderTenantAdmin(root, shellState) {
  root.innerHTML = `${pageTitle("Tenant Admin", "Current-tenant operations only")}${loadingState("Loading tenant administration")}`;

  try {
    const [currentTenant, overview, settings, usage, features] = await Promise.all([
      shellState?.currentTenant ? Promise.resolve(shellState.currentTenant) : TenantApi.current(),
      TenantAdminApi.overview(),
      TenantAdminApi.settings(),
      TenantAdminApi.usage(),
      TenantAdminApi.features()
    ]);

    const featureItems = (features.enabledFeatures || []).map((feature) => badge(feature)).join(" ");
    root.innerHTML = `
      ${pageTitle("Tenant Admin", "Current-tenant operations only")}
      <div class="dashboard-grid">
        ${tenantStatePanel(currentTenant)}
        <section class="panel">
          <div class="section-heading"><h2>Usage</h2>${badge(`${usage.activeUserCount || 0} active users`)}</div>
          <div class="metric-row">
            <div><strong>${escapeHtml(String(usage.projectCount || 0))}</strong><span>Projects</span></div>
            <div><strong>${escapeHtml(String(usage.fileCount || 0))}</strong><span>Files</span></div>
          </div>
        </section>
        <section class="panel span-2">
          <div class="section-heading"><h2>Quota</h2>${badge("Warnings at 80% and 95%")}</div>
          <div class="quota-grid">
            ${quotaRow("Storage", usage.storageUsedBytes || 0, settings.storageQuotaBytes || 0, formatBytes(usage.storageUsedBytes), formatBytes(settings.storageQuotaBytes))}
            ${quotaRow("Users", usage.totalUserCount || usage.activeUserCount || 0, settings.userLimit)}
            ${quotaRow("Projects", usage.projectCount || 0, settings.projectLimit)}
            ${quotaRow("File upload limit", settings.fileUploadLimitBytes || 0, settings.fileUploadLimitBytes || 0, formatBytes(settings.fileUploadLimitBytes), formatBytes(settings.fileUploadLimitBytes))}
          </div>
        </section>
        <section class="panel">
          <div class="section-heading"><h2>Features</h2>${badge(`${features.enabledFeatures?.length || 0} enabled`)}</div>
          <div class="badge-list">${featureItems || emptyState("No enabled tenant features were returned.")}</div>
        </section>
        <section class="panel">
          <div class="section-heading"><h2>Settings</h2>${badge(enumLabel("appMode", currentTenant.appMode))}</div>
          <p>${escapeHtml(settings.displayName || currentTenant.displayName || "")}</p>
          <small>${escapeHtml(settings.defaultLocale || "")} · ${escapeHtml(settings.timeZone || "")}</small>
        </section>
      </div>
    `;
  } catch (error) {
    root.innerHTML = `${pageTitle("Tenant Admin", "")}${errorState(error.message)}`;
  }
}

export async function renderPlatformAdmin(root) {
  root.innerHTML = `${pageTitle("Platform Admin", "Platform-scoped tenant operations")}${loadingState("Loading platform administration")}`;

  try {
    const [overview, usage, tenants, plans] = await Promise.all([
      PlatformAdminApi.overview(),
      PlatformAdminApi.usage(),
      PlatformAdminApi.tenants(),
      PlatformAdminApi.plans()
    ]);

    root.innerHTML = `
      ${pageTitle("Platform Admin", "Platform-scoped tenant operations")}
      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-heading"><h2>Overview</h2>${badge("Platform")}</div>
          <div class="metric-row">
            <div><strong>${escapeHtml(String(overview.tenantCount || tenants.length || 0))}</strong><span>Tenants</span></div>
            <div><strong>${escapeHtml(String(overview.suspendedTenantCount || 0))}</strong><span>Suspended</span></div>
          </div>
        </section>
        <section class="panel">
          <div class="section-heading"><h2>Usage</h2>${badge(formatBytes(usage.totalStorageUsedBytes))}</div>
          <div class="metric-row">
            <div><strong>${escapeHtml(String(usage.totalUserCount || 0))}</strong><span>Users</span></div>
            <div><strong>${escapeHtml(String(usage.totalProjectCount || 0))}</strong><span>Projects</span></div>
          </div>
        </section>
        <section class="panel span-2">
          <div class="section-heading"><h2>Tenants</h2>${badge(`${tenants.length} listed`)}</div>
          <div class="list-table compact">
            ${tenants.map((tenant) => `
              <div>
                <span><strong>${escapeHtml(tenant.displayName || tenant.name)}</strong><small>${escapeHtml(tenant.slug)}</small></span>
                <span>${escapeHtml(enumLabel("tenantStatus", tenant.status))}</span>
                <span>${escapeHtml(tenant.primaryDomain || "No domain")}</span>
              </div>
            `).join("")}
          </div>
        </section>
        <section class="panel span-2">
          <div class="section-heading"><h2>Plans</h2>${badge(`${plans.length} configured`)}</div>
          <div class="badge-list">${plans.map((plan) => badge(plan.name)).join(" ") || emptyState("No plans returned.")}</div>
        </section>
      </div>
    `;
  } catch (error) {
    root.innerHTML = `${pageTitle("Platform Admin", "")}${errorState(error.message || "Platform admin access is required.")}`;
  }
}

export function renderOnPremOnboarding(root, shellState) {
  const currentTenant = shellState?.currentTenant;
  const isOnPremSingleTenant = currentTenant?.appMode === 1 || currentTenant?.appMode === "OnPremSingleTenant";
  root.innerHTML = `
    ${pageTitle(isOnPremSingleTenant ? "On-Prem Setup" : "Tenant Onboarding", "")}
    <section class="panel">
      <div class="checklist">
        ${(isOnPremSingleTenant ? [
          "Default tenant exists",
          "Admin user exists",
          "File storage configured",
          "Database connected",
          "Backup configured",
          "HTTPS configured for production"
        ] : [
          "Create tenant as PlatformAdmin",
          "Configure tenant settings",
          "Invite tenant owner or admin",
          "Confirm tenant status Active"
        ]).map((item) => `<label class="checkbox-row"><input type="checkbox" disabled><span>${escapeHtml(item)}</span></label>`).join("")}
      </div>
    </section>
  `;
}
