# SuperApp

An offline-first PWA for phones with Markdown notes and a recurring payments tracker. Plain HTML/CSS/JS: no build step and no dependencies.

## Features

- **Sections**: the main page shows Personal, Payments, Family, Household, Vehicles, Finance and Work as app icons. Choosing one recolours the app.
- **Payments**: add recurring payments under Bills, Repayments, Subscriptions & Memberships or your own categories, and add your own payment types to any category. Mark each due as paid with the actual amount, and end a payment to keep its history with no future dues. The **Dashboard** shows pending payments, a summary and amounts by category, month-wise or year-wise. The **Report** lists every payment detail for a month or year and exports to PDF through the browser's print dialog. Reminders appear in the app when it is opened; they can't reach the phone while the app is closed. Set the currency in `js/config.js`.
- **Retirals**: load each financial year's EPF passbook PDF from the EPFO member portal and the app reads it on the device, with no upload. It shows your EPF balance, your and your employer's shares, the pension (EPS) balance, interest credited, withdrawals with their purpose, and interest building up this year at last year's rate. Each year is checked against the passbook's printed closing balance. NPS transaction statement CSVs from the CRA load the same way, giving the value, contributions, gain, NPS's XIRR, scheme holdings and transactions, with each statement's units checked scheme by scheme. One Load files button takes any mix of these files. LIC policies are added from the details in the LIC app, with premium receipt PDFs loaded the same way: each shows its premiums paid and left, the expected payout with bonuses, life cover, a minimum surrender value and the return on premiums. Only the employer, the last four digits of member IDs and policy numbers, and the amounts are kept, never your name, date of birth, UAN, address or nominee.
- **Net worth**: adds up Portfolio and Retirals as what you own and takes off what Loans still owe, with a balance sheet, the mix of assets, debt to assets, and what's reachable before retirement. Its Milestones page works like Portfolio's on your net worth: assets grow at a blended return (your portfolio XIRR, EPF and NPS rates, weighted by value) with your monthly portfolio and EPF additions, while each loan's balance falls along its schedule, and a switch shows the effect of investing the EMI once a loan is repaid.
- **Loans**: load a loan's amortization schedule PDF from your lender and the app reads it on the device. Every EMI due up to today is taken as paid, so it shows what's still owed, EMIs paid and left, principal and interest paid so far and still to come, the next EMI's split, the interest over the whole loan, a chart of every EMI's principal and interest, and a year-by-year table. The schedule is checked against its own balances and totals. Only the loan number's last four digits, the rate and the schedule are kept, never your name, customer ID or branch.
- **Portfolio**: manage broker accounts for stocks, mutual funds and crypto. The summaries' Change figure switches between 1D, 5D, 1M, 6M, YTD and 1Y, showing how much today's holdings moved over that period, and each broker card shows the chosen period's change. A Markets strip under the summary shows Nifty 50, Nifty Next 50, Nifty Midcap 150, S&P 500, Nasdaq 100, BTC/INR and ETH/INR with their change over the same period, loaded at most once an hour; each broker's page shows its own market's: Indian indices for Indian brokers, US indices for US brokers and the coins for crypto accounts. Export PDF, on the Portfolio page and each broker's page, makes a summary (totals, asset types across brokers and each broker's asset types) or a detailed report that adds every holding, laid out for A4 and saved with the browser's Save as PDF. Load Zerodha tradebooks (`.xlsx` or `.csv`) , HDFC Securities trade and mutual fund reports (company names are matched to tickers), Vested statements (US shares in USD, converted to INR on the main page), Aionion Capital statements, a Nippon MF account statement (`.xls`) or Zebpay statements (coins locked in Earn stay in holdings), plus the holdings file, to build. The Consolidated page lists every holding in one table, one row a ticker in rupees, with buttons to pick which brokers it covers, and a Summary view of bucket totals alongside the Detailed one. The Timeline report charts money invested over time and lists your investment highlights, latest first; a switch adds estimated past market value from monthly open and close prices, kept on the device. The Performance report compares XIRR by instrument type, market cap or sector with Nifty 50, Nifty Next 50, Nifty Midcap 150, Nasdaq 100 and S&P 500, using the same cash flows, with a chart of that money over 1M, 3M, 6M, 1Y, 5Y or all time, and leaves out commodities and crypto. It also lists your top and worst 10, 20 or 30 stocks, what they add to total returns, and how returns are spread. Analysis has Milestones, which shows when the portfolio reaches ₹1, 2, 5 and 10 Cr with sliders for return, monthly investment and step-up, plus Metrics and Rating. Metrics covers Indian stocks: weighted P/E by market cap against NSE index P/Es, your stocks' and those index P/Es when you bought, volatility against indices, and the stocks beating their index. Rating lists Indian stocks with returns, icon ratings for momentum, growth, valuation and profitability, and a rule-based verdict from them, with a filter for each rating and a switch to hide returns. The Data sources page chooses where public data comes from: the internet, a local backup with nothing downloaded, or a hybrid of recent internet data and older backup months. Public data backs up to one folder a market and one file a month, and that page lists what each file holds and the sources behind it, next to Data disclosure in the Portfolio menu. Wallet accounts hold coins moved out of a broker: the Transfers page lists every send and link, and linking one to the receiving account brings the coins there with their original dates and cost. Reports show fees wherever the broker's files give them, including coins deducted as fees. These build FIFO holdings with splits, bonuses, mergers, demergers, rights issues and IPO allotments applied, then reconcile against the broker. Each open lot shows its original shares and why they changed, and differences can be settled with a rights, IPO, broker transfer or other entry at its own price. Reviewed details show under each holding. Grids can be grouped by sector, market cap, momentum, quality or growth, and a column chooser adds valuation, profitability, quality, growth and momentum fields. Info icons name each figure's source, and the Disclosure page lists them all. XIRR shows on summaries and grids, a privacy icon hides amounts, and Reports cover dividends and capital gains by broker and financial year. Prices come from TradingView's scanner (delayed), splits and dividends from Yahoo Finance through a relay, mutual fund NAVs from mfapi.in and crypto from CoinGecko. Only symbols and fund names leave the device. A first load of splits and dividends runs in the background at about 18 stocks a minute. The Portfolio page backs up all brokers to one `.json` file, and importing it restores however many it holds, along with the loaded splits and dividends. An import merges by default, or can clear all existing brokers first.
- **Data imports**: pinned at the bottom of the Portfolio, Retirals, Loans and Net worth menus. It shows how current your data is, with each broker's latest trade or holdings date, how many days behind that is and when its files were last loaded, plus when each kind of public data was last updated, how many days old it is and how many data points it holds; anything past its usual refresh shows in red. Below is a timeline of every load, newest first and grouped by day, filtered by Broker data, Public data, Retirals, Loans or Backups, each with its time, how many data points it brought in and the latest date its data covers. Entries keep counts and dates only, never file names or amounts, and the timeline is saved in the app backup.
- **Sub-sections**: in the note sections, add them from a dropdown of suggestions, or name your own. Each one is its own notebook that you can rename, move to another section or delete, with a navigation tree grouped by **year → month** (by creation date) and its own **Archive**.
- **Markdown notes** with Edit/Preview modes. The formatting toolbar inserts Markdown for bold, italic, strikethrough, headings, bullet/numbered/check lists, quotes, inline code, code blocks, links, dividers and indent/outdent. Pressing Enter continues a list. Checkboxes can be ticked in Preview.
- **Supported Markdown**: headings, emphasis, `~~strike~~`, `==highlight==`, lists, task lists, quotes, code, tables, links, images and auto-links. Raw HTML is always escaped.
- **Dark theme**: follows the system setting, or you can force Light or Dark in Settings.
- **Local storage**: notes are saved on the device in IndexedDB. The app asks the browser for *persistent* storage so they aren't evicted. Everything works offline.
- **Export / import**: download or share a single `.json` backup, or share one note as `.md`. Importing, from a file or Google Drive, asks whether to merge the backup, where the newer copy of each item wins and nothing is deleted, or to replace everything on the device with it. Replacing first downloads a copy of the current data, and keeps public market data.
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
| `js/nps.js` | Reads NPS transaction statement CSVs, and checks each scheme's units |
| `js/lic.js` | Reads LIC premium receipts, and a policy's premiums, payout and return |
| `js/portfolio-report.js` | Portfolio's summary and detailed reports, printed for Save as PDF |
| `js/import-log.js` | The data import timeline: each load's category, time, data points and dates, kept in the backup |
| `js/milestones.js` | The Milestones page shared by Portfolio and Net worth: projections, what-ifs and the chart |
| `js/networth-view.js` | The Net worth section: balance sheet, asset mix and net worth milestones |
| `js/loan.js` | Reads loan amortization schedule PDFs, and the sums behind Loans |
| `js/loans-view.js` | The Loans section: each loan's EMIs, principal, interest and schedule |
| `js/retirals-view.js` | The Retirals section: EPF accounts, LIC policies, years and passbook entries |
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
