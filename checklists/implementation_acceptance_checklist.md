# Pixel Soft Utility — Implementation Acceptance Checklist

Use this at the end of every Codex implementation or refactor.

## Must pass

- [ ] The app imports or copies the shared `design-system/` files instead of inventing local UI primitives.
- [ ] The app has a valid `app.manifest` with `app_id`, `app_name`, `app_subtitle`, `app_symbol`, `primary_purpose`, and `main_sections`.
- [ ] The root element receives `data-theme`, `data-mode`, and `data-resolved-mode`.
- [ ] Theme state persists as `{app_id}-theme` and `{app_id}-mode`.
- [ ] The theme picker includes exactly six themes: Lavender, Mint, Sky, Amber, Rose, Graphite.
- [ ] System, Light, and Dark mode work and update browser `color-scheme`.
- [ ] The mobile header is the shared AppHeader pattern: icon, title, subtitle, spacer, profile/overflow.
- [ ] The header contains no version, build, SHA, server URL, status, storage, download count, CSV status, sync status, or admin badge.
- [ ] Primary actions are placed in HeroCards/content cards/forms, not permanently in the header.
- [ ] Technical info is only in About/Admin/Diagnostics/Logs in sheets.
- [ ] No hardcoded component colors outside central tokens.
- [ ] No local component-specific radius/spacing/shadow systems.
- [ ] Buttons are pill-shaped and at least 44px high.
- [ ] Inputs are at least 48px high.
- [ ] Icon-only buttons have `aria-label`.
- [ ] Focus states are visible.
- [ ] `prefers-reduced-motion` is implemented.
- [ ] Mobile is single-column and avoids copied desktop tables.
- [ ] Desktop uses dashboard patterns and does not use mobile bottom nav.
- [ ] Icons are local/inline/self-hosted, not external CDN core dependencies.

## Recommended

- [ ] Settings/Profile/About/Admin sheets all use the same ListRow structure.
- [ ] Theme picker uses a 2x3 grid on mobile for six theme buttons.
- [ ] App-specific status is visible only where useful: HeroCard, dashboard card, list section header, or Admin Info.
- [ ] Empty states use one icon, one short title, one helpful hint, and one optional action.
- [ ] Toasts are used for saved/copied/undo feedback instead of blocking dialogs.


## Logo Identity

- [ ] `app_logo` ist im App-Manifest definiert, wenn ein User-Logo vorhanden ist.
- [ ] Header rendert `app_logo.src` bzw. `light_src`/`dark_src` im gemeinsamen `.psu-app-symbol`.
- [ ] `app_symbol` bleibt als lokaler SVG-Fallback erhalten.
- [ ] `<link rel="icon">` nutzt `app_logo.favicon` oder `app_logo.src`.
- [ ] PWA Icons, falls vorhanden, sind aus demselben Logo abgeleitet.
- [ ] Logo-Alt ist im Header leer, wenn Appname sichtbar daneben steht.
- [ ] About/Profile/Empty-State nutzen das Logo nur sinnvoll und nicht dekorativ überladen.
- [ ] Es wurden keine Farben, Radien, Shadows oder Komponentenstile aus dem Logo abgeleitet.


## Universal Setup / Auth

- [ ] `contracts/setup_bootstrap_contract.yaml` wurde beachtet.
- [ ] First-Run Setup wird vor normaler App-Nutzung erzwungen.
- [ ] Setup-Secret wird über `ISHIKU_SETUP_SECRET_FILE` oder Fallback `ISHIKU_SETUP_SECRET` gelesen.
- [ ] Admin-Passwort darf nicht mit Setup-Secret übereinstimmen.
- [ ] Registrierung schließt nach dem ersten Adminaccount.
- [ ] Login/Register/Auth-Fenster nutzen dieselben Pixel Soft Utility Komponenten.

## GitHub README

- [ ] README.md folgt `contracts/github_readme_contract.yaml`.
- [ ] README nutzt die Struktur aus `templates/github/README.template.md`.
- [ ] README erklärt First-Run Setup und Docker Secret.
- [ ] README enthält den Abschnitt `Teil der ishiku-Familie`.
- [ ] README enthält den Abschnitt `Erstellt mit ChatGPT Codex`.
- [ ] README enthält keine echten Secrets, privaten URLs, lokalen Datenpfade oder Datenbankinhalte.
