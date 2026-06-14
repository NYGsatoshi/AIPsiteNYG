import { AuthApi } from "../api.js";
import { enumLabel } from "../enums.js";
import { escapeHtml } from "../utils.js";
import { t } from "../i18n/index.js";

export function renderUserMenu(container, user) {
  container.innerHTML = `
    <div class="user-menu">
      <div>
        <strong>${escapeHtml(user.displayName)}</strong>
        <span>${escapeHtml(enumLabel("systemRole", user.systemRole))}</span>
      </div>
      <button class="text-button" type="button" data-logout>${t("auth.signOut")}</button>
    </div>
  `;

  container.querySelector("[data-logout]").addEventListener("click", async () => {
    await AuthApi.logout();
    location.href = "/";
  });
}
