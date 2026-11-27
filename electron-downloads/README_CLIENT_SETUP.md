# Dharani Weighbridge — Client Laptop Setup & Prerequisite Guide

This guide is for setting up a **brand-new, fresh Windows laptop** for the client.

The Dharani Weighbridge Desktop Application bundles all its own frontend code, backend code, and Node.js runtimes inside the `.exe` installer. **You do NOT need to install Node.js, Git, or Python on the client laptop.**

A brand-new laptop requires only **two standard Windows prerequisites** to operate offline with local weighing data:

---

## Required Prerequisites for a Brand-New Laptop

| Prerequisite | Why It Is Needed | Direct Download Link |
| :--- | :--- | :--- |
| **1. Visual C++ 2015–2022 Redistributable (x64)** | Required by Windows for MySQL Server and hardware serial scale communication. | [Download Official Microsoft VC++ (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe) |
| **2. MySQL Community Server 8.0** | Required for local offline database storage (`dharani_weighbridge`). | [Download MySQL 8.0 Community Installer](https://dev.mysql.com/downloads/installer/) |

---

## 3-Minute Step-by-Step Installation

### Step 1: Install Visual C++ Redistributable (15 seconds)
1. Download [vc_redist.x64.exe](https://aka.ms/vs/17/release/vc_redist.x64.exe).
2. Run it, check **"I agree to the license terms"**, and click **Install**.

---

### Step 2: Install MySQL Server 8.0 (2 minutes)
1. Download **MySQL Community Server 8.0** installer:
   - File: `mysql-installer-community-8.0.40.0.msi` (or latest 8.0 version).
2. Choose Setup Type: **Server only** (or **Developer Default**).
3. Click **Next** until you reach the **Type and Networking** screen:
   - Config Type: `Development Computer`
   - TCP/IP Port: `3306` (default).
4. In the **Accounts and Roles** screen:
   - Enter **MySQL Root Password**: `dharani_db_pass`
   - Repeat Password: `dharani_db_pass`
5. In the **Windows Service** screen:
   - Ensure **"Start the MySQL Server at System Startup"** is CHECKED.
6. Click **Execute** and **Finish**.

> **Note:** If you set a different password during MySQL installation (e.g. `root`), simply open:
> `%APPDATA%\Dharani Weighbridge\server.env` and change `DB_PASSWORD=YOUR_PASSWORD`.

---

### Step 3: Run the Verification Script (Optional)
Double-click `verify-system.bat` in this folder. It will display a green confirmation screen confirming:
- Visual C++ is installed.
- MySQL Windows Service is running.
- Port 3306 is open and accepting connections.

---

### Step 4: Install & Launch Dharani Weighbridge
1. Double-click `Dharani-Weighbridge-Setup-1.0.3-x64.exe` to install.
2. Open **Dharani Weighbridge** from your Desktop shortcut.
3. Sign in with the default credentials:
   - **Username or Email**: `admin`
   - **Password**: `admin123`
4. Click **Access System →**.

The application will automatically initialize the local `dharani_weighbridge` database and begin synchronizing with the central server every 5 minutes.
