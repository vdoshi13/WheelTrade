# Wheel Tracker — iPhone app

A home-screen web app for logging wheel-strategy trades, managing contracts and viewing the dashboard. It is hosted on GitHub Pages and talks to your Google Sheet through an Apps Script API.

This repo contains only the app itself. Your trades stay in your Google Sheet, and the app key and web app URL are stored only on your phone. Neither is ever committed here.

## One-time setup

### 1. Apps Script (in your tracker sheet)
1. Open **Extensions › Apps Script** and replace `Code.gs` with the updated `WheelTracker.gs`. Save.
2. Reload the sheet, then run **Wheel Tracker › Generate Mobile App Key**. Copy the key it shows.
3. Click **Deploy › New deployment › Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the **Web app URL** (it ends in `/exec`).

Keep your existing "Only myself" deployment as it is. Its link keeps working for you, and the script refuses to serve that page to anyone who isn't signed in as you.

### 2. GitHub Pages
1. Create a new **public** repository, for example `wheel-tracker`.
2. Upload every file in this folder to the repository root, including `.nojekyll` and the `icons` folder.
3. Go to **Settings › Pages**. Under Source, choose **Deploy from a branch**, then **main** and **/ (root)**. Save.
4. After a minute your app is live at `https://<your-username>.github.io/wheel-tracker/`.

### 3. iPhone
1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share › Add to Home Screen**.
3. Open the app from its icon and enter the web app URL and app key. Tap **Connect**.

Add it to the home screen before you connect. The installed app keeps its own storage, separate from Safari.

## Updating

- **Apps Script changes:** go to **Deploy › Manage deployments**, edit the "Anyone" deployment and choose **Version › New version**. The URL stays the same.
- **App changes:** commit the new files to the repository. The app picks up the update the next time it's opened after the commit, and fully applies it on the launch after that. To force an immediate refresh, change `CACHE` in `sw.js` (for example to `wheel-tracker-v2`).

## Security

- Anyone with **both** the web app URL and the app key can read and change your tracker. Treat the key like a password.
- To lock out a lost phone or a leaked key, run **Generate Mobile App Key** again. The old key stops working right away. Enter the new key on your phone under **Settings**.
- The API only accepts the specific trade and dashboard actions the app uses. It can't run menu or maintenance functions.
- If your Google account is a work (Google Workspace) account, your admin may not allow "Anyone" access. In that case, host the sheet on a personal Google account.
