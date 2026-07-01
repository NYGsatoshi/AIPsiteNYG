# Frontend internationalization

The legacy vanilla JavaScript i18n layer under `src/AipPortal.Web/wwwroot/scripts/i18n` was removed with the static SPA. MVP-A P0 frontend work should define i18n inside the Angular source under `frontend/`.

## Locales

Do not add new locale files under `src/AipPortal.Web/wwwroot`. That directory is for hosted Angular build artifacts only.

Angular locale file paths, the default locale, and persistence rules are pending frontend implementation.

## Adding UI text

1. Add text through the Angular i18n mechanism selected for MVP-A.
2. Keep keys or message identifiers hierarchical and feature-oriented, for example:
   - `common.save`
   - `auth.signIn`
   - `nav.projects`
   - `projects.empty`
   - `chat.messageRequired`
3. Use interpolation for dynamic UI text.

## Rules

- New visible UI text must use translation keys instead of hardcoded English or Japanese strings.
- Do not translate user-generated content, including posts, chat messages, comments, uploaded file names, project names, user-entered titles, descriptions, or free-form text fields.
- Date/time display should use the selected locale through the shared formatting helpers.
- Keep Japanese concise and natural for school users.
