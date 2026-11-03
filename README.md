# SuperApp

An offline-first PWA for phones with Markdown notes and a recurring payments tracker. Plain HTML/CSS/JS: no build step and no dependencies.

## Features

- **Sections**: the main page shows Personal, Payments, Family, Household, Vehicles, Finance and Work as app icons. Choosing one recolours the app.
- **Payments**: add recurring payments under Bills, Repayments, Subscriptions & Memberships or your own categories, and add your own payment types to any category. Mark each due as paid with the actual amount, and end a payment to keep its history with no future dues. The **Dashboard** shows pending payments, a summary and amounts by category, month-wise or year-wise. The **Report** lists every payment detail for a month or year and exports to PDF through the browser's print dialog. Reminders appear in the app when it is opened; they can't reach the phone while the app is closed. Set the currency in `js/config.js`.
- **Retirals**: load each financial year's EPF passbook PDF from the EPFO member portal and the app reads it on the device, with no upload. It shows your EPF balance, your and your employer's shares, the pension (EPS) balance, interest credited, withdrawals with their purpose, and interest building up this year at last year's rate. Each year is checked against the passbook's printed closing balance. Only the employer, the member ID's last four digits and the amounts are kept, never your name, date of birth or UAN.
- **Portfolio**: manage broker accounts for stocks, mutual funds and crypto. Load Zerodha tradebooks (`.xlsx` or `.csv`) , HDFC Securities trade and mutual fund reports (company names are matched to tickers), Vested statements (US shares in USD, converted to INR on the main page), Aionion Capital statements, a Nippon MF account statement (`.xls`) or Zebpay statements (coins locked in Earn stay in holdings), plus the holdings file, to build. The Consolidated page lists every holding in one table, one row a ticker in rupees, with buttons to pick which brokers it covers, and a Summary view of bucket totals alongside the Detailed one. The Timeline report charts money invested over time and lists your investment highlights, latest first; a switch adds estimated past market value from monthly open and close prices, kept on the device. The Performance report compares XIRR by instrument type, market cap or sector with Nifty 50, Nifty Next 50, Nifty Midcap 150, Nasdaq 100 and S&P 500, using the same cash flows, with a chart of that money over 1M, 3M, 6M, 1Y, 5Y or all time, and leaves out commodities and crypto. It also lists your top and worst 10, 20 or 30 stocks, what they add to total returns, and how returns are spread. Analysis has Milestones, which shows when the portfolio reaches ₹1, 2, 5 and 10 Cr with sliders for return, monthly investment and step-up, plus Metrics and Rating. Metrics covers Indian stocks: weighted P/E by market cap against NSE index P/Es, your stocks' and those index P/Es when you bought, volatility against indices, and the stocks beating their index. Rating lists Indian stocks with returns, icon ratings for momentum, growth, valuation and profitability, and a rule-based verdict from them, with a filter for each rating and a switch to hide returns. The Data sources page chooses where public data comes from: the internet, a local backup with nothing downloaded, or a hybrid of recent internet data and older backup months. Public data backs up to one folder a market and one file a month, and that page lists what each file holds and the sources behind it, next to Data disclosure in the Portfolio menu. Wallet accounts hold coins moved out of a broker: the Transfers page lists every send and link, and linking one to the receiving account brings the coins there with their original dates and cost. Reports show fees wherever the broker's files give them, including coins deducted as fees. These build FIFO holdings with splits, bonuses, mergers, demergers, rights issues and IPO allotments applied, then reconcile against the broker. Each open lot shows its original shares and why they changed, and differences can be settled with a rights, IPO, broker transfer or other entry at its own price. Reviewed details show under each holding. Grids can be grouped by sector, market cap, momentum, quality or growth, and a column chooser adds valuation, profitability, quality, growth and momentum fields. Info icons name each figure's source, and the Disclosure page lists them all. XIRR shows on summaries and grids, a privacy icon hides amounts, and Reports cover dividends and capital gains by broker and financial year. Prices come from TradingView's scanner (delayed), splits and dividends from Yahoo Finance through a relay, mutual fund NAVs from mfapi.in and crypto from CoinGecko. Only symbols and fund names leave the device. A first load of splits and dividends runs in the background at about 18 stocks a minute. The Portfolio page backs up all brokers to one `.json` file, and importing it restores however many it holds, along with the loaded splits and dividends. An import merges by default, or can clear all existing brokers first.
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
| `js/portfolio.js` | FIFO replay of trades and corporate actions, gains, reconciliation |
| `js/portfolio-view.js` | Broker accounts, holdings table, stock drill-down, reconcile pages |
| `js/portfolio-import.js` | Reads broker tradebooks and holdings files |
| `js/pdf-text.js` | Reads the text of simple PDFs, such as EPF passbooks, with no library |
| `js/epf.js` | Reads EPF passbooks, checks each year, and the sums behind Retirals |
| `js/retirals-view.js` | The Retirals section: EPF accounts, years and passbook entries |
| `js/public-data.js` | Public data backups: month files by market, merging and zips |
| `js/disclosures.js` | Every outside data source and the figures it feeds, shown on the Disclosure page |
| `js/ratings.js` | Rules for grouping holdings by market cap, momentum, quality and growth |
| `js/tickers.js` | Matches company names in broker files to tickers |
| `js/corporate-actions.js` | Mergers, demergers, rights issues and IPOs Yahoo doesn't carry |
| `js/market.js` | Prices, splits, dividends, fund NAVs and crypto quotes |
| `js/xlsx.js` | Reads `.xlsx`, `.xls` and `.csv` files in the browser |
| `js/markdown.js` | Safe Markdown renderer |
| `js/db.js` | IndexedDB storage |
| `js/drive.js` | Google sign-in + Drive upload/download |
| `js/config.js` | Version, Google Client ID and currency |
| `sw.js` | Offline cache. Bump `VERSION` when you ship changes |
