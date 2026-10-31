# SuperApp

An offline-first PWA for phones with Markdown notes and a recurring payments tracker. Plain HTML/CSS/JS: no build step and no dependencies.

## Features

- **Sections**: the main page shows Personal, Payments, Family, Household, Vehicles, Finance and Work as app icons. Choosing one recolours the app.
- **Payments**: add recurring payments under Bills, Repayments, Subscriptions & Memberships or your own categories, and add your own payment types to any category. Mark each due as paid with the actual amount, and end a payment to keep its history with no future dues. The **Dashboard** shows pending payments, a summary and amounts by category, month-wise or year-wise. The **Report** lists every payment detail for a month or year and exports to PDF through the browser's print dialog. Reminders appear in the app when it is opened; they can't reach the phone while the app is closed. Set the currency in `js/config.js`.
- **Sub-sections**: in the note sections, add them from a dropdown of suggestions, or name your own. Each one is its own notebook that you can rename, move to another section or delete, with a navigation tree grouped by **year → month** (by creation date) and its own **Archive**.
- **Markdown notes** with Edit/Preview modes. The formatting toolbar inserts Markdown for bold, italic, strikethrough, headings, bullet/numbered/check lists, quotes, inline code, code blocks, links, dividers and indent/outdent. Pressing Enter continues a list. Checkboxes can be ticked in Preview.
- **Supported Markdown**: headings, emphasis, `~~strike~~`, `==highlight==`, lists, task lists, quotes, code, tables, links, images and auto-links. Raw HTML is always escaped.
- **Dark theme**: follows the system setting, or you can force Light or Dark in Settings.
- **Local storage**: notes are saved on the device in IndexedDB. The app asks the browser for *persistent* storage so they aren't evicted. Everything works offline.
- **Export / import**: download or share a single `.json` backup, or share one note as `.md`. Importing merges the backup: the newer copy of each note wins and nothing is deleted.
- **Google Drive backup** with Google sign-in: back up or restore one file (`superapp-notes-backup.json`), and optionally back up automatically after changes.
- **Trash**: deleted notes are restorable for 30 days and then purged automatically. You can also empty the trash by hand.

## Run locally

```powershell
.\serve.ps1          # http://localhost:8080
```

Service workers and Google sign-in need either `localhost` or **HTTPS**. To use the app on a phone, deploy the folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, Firebase Hosting…). Then open it in Chrome (Android) or Safari (iOS) and choose **Install app** / **Add to Home Screen**.

## Set up Google Drive backup

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: configure it (External) and add the scope `.../auth/drive.file`. While the app is in *Testing*, add your Google account as a test user.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized JavaScript origins**, add each origin you serve from, e.g. `http://localhost:8080` and `https://you.github.io`.
5. Put the Client ID in `js/config.js` (`googleClientId`), or paste it into **Settings → Google Drive backup** in the app.

The app only requests `drive.file`, so it can see only the files it creates, not the rest of your Drive. Access tokens last about an hour. When one expires, the next backup asks you to sign in again (usually one tap).

## Files

| Path | Purpose |
|---|---|
| `index.html` | App shell |
| `css/styles.css` | Styles, light/dark tokens |
| `js/app.js` | Routing, views, editor, backup, trash |
| `js/sections.js` | Sections: names, icons, colours, suggested sub-sections |
| `js/payments.js` | Payment categories, due-date schedule and stored shapes |
| `js/payments-view.js` | Payments dashboard, manage pages, report and actions |
| `js/markdown.js` | Safe Markdown renderer |
| `js/db.js` | IndexedDB storage |
| `js/drive.js` | Google sign-in + Drive upload/download |
| `js/config.js` | Version, Google Client ID and currency |
| `sw.js` | Offline cache. Bump `VERSION` when you ship changes |
