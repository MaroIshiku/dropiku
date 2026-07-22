# Setup, Security und README Checkliste

## First-Run Setup

- [ ] App erkennt, ob ein Adminaccount existiert.
- [ ] Wenn kein Admin existiert, erscheint sofort das RegisterWindow.
- [ ] Normale App-Inhalte sind vor Setup nicht erreichbar.
- [ ] RegisterWindow nutzt Pixel Soft Utility Komponenten und App-Logo.
- [ ] RegisterWindow ist nicht dismissible.
- [ ] Setup-Secret-Feld ist vorhanden.
- [ ] Admin-Benutzername, Anzeigename, Passwort und Passwort-Wiederholung sind vorhanden.
- [ ] Passwortregeln sind sichtbar und verständlich.
- [ ] Initialer Fokus liegt auf dem Setup-Secret-Feld.

## Secret und Validierung

- [ ] App liest bevorzugt `ISHIKU_SETUP_SECRET_FILE`.
- [ ] Standardpfad ist `/run/secrets/ishiku_setup_secret`.
- [ ] `ISHIKU_SETUP_SECRET` ist nur Fallback.
- [ ] Setup-Secret wird serverseitig geprüft.
- [ ] Falsche Setup-Versuche werden rate-limited.
- [ ] Setup-Secret wird nie geloggt.
- [ ] Kein Secret-Wert erscheint in UI, About, Admin Info, Logs oder README.

## Admin-Passwort

- [ ] Admin-Passwort darf nicht mit Setup-Secret übereinstimmen.
- [ ] Admin-Passwort ist mindestens 12 Zeichen lang.
- [ ] Platzhalter-Passwörter werden abgelehnt.
- [ ] Passwort und Wiederholung müssen übereinstimmen.
- [ ] Passwort wird nur gehasht gespeichert.
- [ ] Kein Klartext-Passwort in Datenbank, Logs oder Debug-Ausgabe.

## Setup-Abschluss

- [ ] Erster Admin wird transaktional erstellt.
- [ ] `setup_completed` wird erst nach erfolgreicher Admin-Erstellung gesetzt.
- [ ] Registrierung ist danach geschlossen.
- [ ] `/setup` redirectet nach abgeschlossenem Setup zu Login/Dashboard.
- [ ] Weitere Admins entstehen nur durch eingeloggte Admins im Adminbereich.

## Docker/GitHub

- [ ] `docker-compose.example.yml` vorhanden.
- [ ] `.env.example` vorhanden.
- [ ] `secrets/setup_secret.txt` wird nicht committed.
- [ ] `/data`, Logs und Datenbanken werden nicht committed.
- [ ] README folgt `templates/github/README.template.md`.
- [ ] README enthält Installation, Erststart, Adminaccount, Docker Secrets, Sicherheit und Codex-Hinweis.
