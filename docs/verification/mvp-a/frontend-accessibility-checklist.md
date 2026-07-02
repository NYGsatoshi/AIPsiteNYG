# MVP-A P0 Frontend Accessibility Checklist

Use this checklist with Desktop Chrome, Desktop Edge, Chromebook Chrome, iPad Safari, and a 320px-wide phone viewport.

## Keyboard And Focus

- Tab reaches the mobile header or account rail, feature navigation, top bar search, main content controls, and right panel trigger.
- Focus order follows the visual layout and does not enter hidden mobile drawers or collapsed panels.
- Visible focus indicators appear on links, buttons, form fields, grid controls, drawer controls, and dialog controls.
- Escape closes open drawers and dialogs where safe, then returns focus to the trigger.

## Drawers, Dialogs, And Menus

- Mobile navigation drawer traps focus while open and closes on Escape, route change, or outside scrim click.
- Right panel opens as a drawer on tablet/mobile, traps focus, closes on Escape or scrim click, and returns focus to the top-bar trigger.
- Confirm and audit-reason dialogs trap focus, label their title/description, close on Escape where safe, and return focus to the trigger.
- Inline admin detail drawers move focus to their close button and close on Escape without acting as modal traps.

## Labels And Forms

- Icon-only controls have accessible names.
- Search, invite registration, password, and announcement form controls have labels associated with controls.
- Field errors are connected with `aria-describedby` or announced with alert/status semantics.
- Error summaries show safe `requestId` or `localErrorId` and never raw stack traces.

## Grids And Row Actions

- Grid toolbar and pagination controls are keyboard reachable.
- Row action buttons are keyboard reachable and visibly focused.
- Context menus remain disabled unless a keyboard-open path, Escape close, outside-click close, route-change close, and scroll-close behavior are implemented.
- AG Grid Enterprise is not installed or used.

## Responsive Safety

- Core routes have no document-level horizontal overflow at 320px.
- Long workspace names, request IDs, file names, summaries, and audit/export details wrap or scroll inside their own component.
- Mobile drawers use the capability-filtered navigation list and do not expose hidden routes/actions.
- Mobile layouts do not render unauthorized data or alternate hidden admin/export actions.
