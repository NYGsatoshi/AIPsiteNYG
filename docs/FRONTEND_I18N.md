# Frontend internationalization

The frontend uses a small vanilla JavaScript i18n layer because the current UI is served from `src/AipPortal.Web/wwwroot` without a frontend framework or package build step.

## Locales

Locale files are stored in:

```text
src/AipPortal.Web/wwwroot/scripts/i18n/locales/en-US.js
src/AipPortal.Web/wwwroot/scripts/i18n/locales/ja-JP.js
```

`ja-JP` is the default locale. `en-US` remains available through the language selector. The selected locale is persisted in `localStorage` under `aip.locale`.

## Adding UI text

1. Add the same stable key to both locale files.
2. Use the `t` helper from `scripts/i18n/index.js` in UI code.
3. Keep keys hierarchical and feature-oriented, for example:
   - `common.save`
   - `auth.signIn`
   - `nav.projects`
   - `projects.empty`
   - `chat.messageRequired`
4. Use interpolation for dynamic UI text: `t("placeholder.unimplemented", { title })`.

## Rules

- New visible UI text must use translation keys instead of hardcoded English or Japanese strings.
- Do not translate user-generated content, including posts, chat messages, comments, uploaded file names, project names, user-entered titles, descriptions, or free-form text fields.
- Date/time display should use the selected locale through the shared formatting helpers.
- Keep Japanese concise and natural for school users.
