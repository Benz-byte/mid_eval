# Project Setup Guide

This guide explains how to install and run Auto Scheduler after cloning it from
GitHub or downloading it as a ZIP file.

## Requirements

Install these programs before setting up the project:

- [Node.js](https://nodejs.org/) 18 or newer
- [Python](https://www.python.org/downloads/) 3.10 or newer
- [Git](https://git-scm.com/downloads) when cloning the repository
- [Visual Studio Code](https://code.visualstudio.com/) or another code editor

Verify that Node.js, npm, and Python are available:

```powershell
node --version
npm --version
python --version
```

If a command is not recognized, install the corresponding program and restart
the terminal.

## Option 1: Clone from GitHub

Open PowerShell or the VS Code terminal and run:

```powershell
git clone https://github.com/Benz-byte/mid_eval.git
cd mid_eval
code .
```

If `code` is not recognized, open Visual Studio Code, select **File → Open
Folder**, and choose the cloned `mid_eval` folder.

## Option 2: Download from GitHub

1. Open the repository on GitHub.
2. Select **Code → Download ZIP**.
3. Right-click the downloaded ZIP and select **Extract All**.
4. Open Visual Studio Code.
5. Select **File → Open Folder**.
6. Choose the extracted `mid_eval-main` folder.

Do not open the ZIP file directly. The project must be extracted first.

## Install JavaScript Packages

Open a terminal in the project folder—the folder containing `package.json`—and
run:

```powershell
npm install
```

This command installs the JavaScript packages and automatically installs the
Python packages from `python\requirements.txt`.

## Supabase Configuration

The tracked `.env` file already contains the public Supabase configuration:

```env
VITE_SUPABASE_URL=https://petevdqelbhnzlznvwdw.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=already-configured
```

Collaborators do not create or edit an environment file. They receive the
configuration automatically through GitHub.

Only a Supabase publishable key may be stored in this frontend configuration.
Never add a service-role key, secret key, private key, or database password.

## Run the Application

Start the application with:

```powershell
npm run dev
```

This starts:

- Vite at `http://localhost:5173`
- Electron
- Flask at `http://127.0.0.1:5000`

The Electron desktop window should open automatically.

## How Schedule Loading Works

The interface does not depend on the database to start:

```text
Open React interface immediately
        ↓
Show locally saved data or an empty calendar
        ↓
Request the schedule from Supabase
        ↓
Plot returned classes and events on the calendar
```

Supabase is a schedule data source. It does not run or host the interface. If
the database or internet is unavailable, the tabs and calendar still display.

CSV imports and events added through the UI are stored in that device's browser
storage as a fallback. Manually added events are also written to the Supabase
`admin_events` table. Adding, editing, or deleting an event triggers a realtime
refresh on other running devices.

The header can show:

- **Database schedule loaded** — Supabase data was loaded and plotted
- **No database schedule** — the connection worked, but no schedule row exists
- **Database unavailable** — the UI remains open using local data
- **Local schedule** — Supabase configuration is not present

## Enable Shared Event Synchronization

The repository owner must run this file once in **Supabase Dashboard → SQL
Editor**:

```text
database/supa/migrations/002_admin_events.sql
```

The migration:

- Creates one database row per manually added event
- Allows anonymous and authenticated prototype users to read, create, update,
  and delete events
- Enables Supabase Realtime
- Copies events from the old `shared_schedules.admin_events` JSON array

After the migration runs, deleting an event removes its database row. Reopening
the app or using another device will no longer restore that deleted event.

## Test Flask

While the application is running, open this address in a browser:

```text
http://127.0.0.1:5000/api/health
```

A working Flask service returns:

```json
{"status": "ok"}
```

## Common Problems

### VS Code shows no files

Select **File → Open Folder** and open the cloned or extracted project folder.
Cloning a repository does not automatically open it in VS Code.

### Electron opens as a blank window

Wait until the terminal displays the Vite address, then press `Ctrl+R` in the
Electron window. Check that `.env` contains the real Supabase URL and
publishable key.

### `npm` is not recognized

Install Node.js and restart VS Code.

### `python` is not recognized

Install Python and enable **Add Python to PATH** during installation, then
restart VS Code.

### Python reports a missing Flask module

Run:

```powershell
python -m pip install -r python\requirements.txt
```

### Port 5173 or 5000 is already in use

Close any older Auto Scheduler, Vite, Electron, or Flask process, then run:

```powershell
npm run dev
```

## Updating an Existing Clone

If the repository was cloned previously, download the latest committed changes:

```powershell
git switch main
git pull origin main
npm install
```

Then start the application again with:

```powershell
npm run dev
```
