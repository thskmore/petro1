# Petrol Pump Manager: server

Node.js + SQLite backend with logins (owner, manager, worker), shared business data, and a worker screen that posts credit sales straight into the customer ledger.

- `server.js`: the whole backend (one file)
- `public/index.html`: the app (ledger, invoices, stock, suppliers, book, reports, backup, team, worker screen)
- `data.db`: created on first run; this is all your data

## Roles

| Role | Can do |
|---|---|
| Owner | Everything: Pump setup, Salary, Team (managers and workers), approving the business day |
| Manager | Assigns duties, reviews and closes them, closes the business day, daily summary, ledger, invoices, stock, suppliers, tanks, reports. Can add and manage workers in Team. No Pump setup, no Salary |
| Worker | Their assigned duty, credit sales, tank dips, and their own pay. Can open the full detail of their past duties |

Worker credit sales appear in the customer ledger immediately. If a sale is over the customer's available credit, it is held as "waiting for approval" instead. Managers and the owner see it at the top of the Ledger tab and can approve it (it then posts to the ledger) or reject it. The worker sees the status on their screen.

## Duty flow

1. **Owner, one time: Pump setup.** Add nozzles (fuel, tank, active or inactive), each nozzle's opening reading for its first duty, fuel rates with a start date, expense categories, and payment modes (turn off the ones you do not use). Credit customers can be made inactive here too.
2. **Manager: Duty tab, Assign duty.** Pick the worker, shift and nozzles. A nozzle already with another worker is locked until that duty is closed. The opening reading is filled from the nozzle's last closing and the rate from the fuel rate table.
3. **Worker:** opens the assigned duty and enters closing readings and testing litres, any lube or shop items sold (picked from Stock), expenses paid from the till, and the money collected by payment mode. Opening and rate are locked. Credit sales saved during the duty are counted automatically. The screen shows expected collection and whether it is short, in excess, or tallies, then the worker submits.
4. **Manager:** reviews the submitted duty, corrects anything, and closes it. Closing a duty reduces lube and shop stock. Then **Close day** when all duties are closed.
5. **Owner:** **Approve day** (or reopen it). The **Day report** shows a summary and a worker-wise detail, for closed duties only. Print it from there.

Expected collection = fuel sales + lube and shop sales, minus credit sales, minus expenses paid from the till. The business day runs from 6 AM to 6 AM, so a night shift past midnight belongs to the previous day.

## Tank stock and dip readings

1. Owner or manager: **Tanks** tab, then **Tanks setup**. Add each tank with its capacity and, optionally, its dip chart (one line per reading, as `dip, litres`). Then, in **Duty**, edit each nozzle and link it to its tank.
2. **Fuel delivery** records a tanker: bill amount, bill number, and litres per tank (up to 3 tanks). The bill is added to the oil company account in Suppliers automatically.
3. **Add dip reading** (managers) or the **Tank dip** tab (workers) records a dip, either as litres or as a dip converted through the tank's chart.
4. Each new dip is checked against the previous one: opening dip + deliveries in between, minus fuel sold on that tank's nozzles (from submitted duties), equals the expected stock. The difference is shown in red when it is more than 0.5% of the fuel sold (and at least 5 L).

## Worker salary

Workers are paid per duty. In the owner-only **Salary** tab:

1. **Set rates** for each worker and shift (Morning, Evening, Night).
2. Each month shows closed duties × rate, plus **bonus**, minus **advances** and **cash shortages** from those duties.
3. **Waive shortage** removes some or all of the shortage deduction. **Record payment** reduces the balance still to pay.
4. Duties still open or waiting for the manager to close are not counted until they are closed.
5. Each worker can see their own month under **My pay**. Managers cannot see the Salary tab.

## Daily summary on WhatsApp

In the **Duty** tab, pick a date and tap **Daily summary**. It builds a message with fuel sold by fuel, collections and shortages, credit sales and total outstanding, tank stock and low-stock items. Tap **Open WhatsApp** and the message is ready to send (to the owner's number by default, or any number you type). You press send yourself. Sending it automatically each night needs the official WhatsApp Business API from Meta and is not included yet.

## Payment reminders

On the **Ledger** tab, tap **Send reminders to everyone with dues**. You see every customer who owes money (largest first) and an editable message. WhatsApp can only open one chat at a time, so tap **Send** beside each customer, or **Open next** to go down the list. Each customer shows when they were last reminded.

## Try it on your computer

```bash
npm install
node server.js
# open http://127.0.0.1:3000 and create the owner account
```

## Put it on Oracle Cloud (Always Free VM)

1. **Create the VM.** Ubuntu 22.04 or 24.04. Note its public IP.
2. **Open web ports.** In the VM's subnet security list, allow ingress TCP 80 and 443. Then on the VM:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. **Install Node 22.**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
4. **Copy this folder** to `/opt/petrol-app` (for example with `scp -r`), then:
   ```bash
   cd /opt/petrol-app && npm install --omit=dev
   ```
5. **Run it as a service.** Create `/etc/systemd/system/petrol.service`:
   ```ini
   [Unit]
   Description=Petrol pump server
   After=network.target

   [Service]
   WorkingDirectory=/opt/petrol-app
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Restart=always
   User=ubuntu

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now petrol
   ```
6. **Add HTTPS (required).** Logins send passwords, so never use plain HTTP. You need a domain name (a free one from duckdns.org works) pointing at the VM's IP. Then:
   ```bash
   sudo apt-get install -y caddy
   ```
   Put this in `/etc/caddy/Caddyfile` and run `sudo systemctl reload caddy`:
   ```
   yourname.duckdns.org {
       reverse_proxy 127.0.0.1:3000
   }
   ```
7. **Open your address** in a browser, create the owner account, then add managers and workers in the Team tab. On phones, use "Add to Home screen".

## Backups (do this)

Your data is one file. Copy it every night, and also download a backup from the Backup tab now and then.

```bash
sudo apt-get install -y sqlite3
mkdir -p ~/backups
( crontab -l 2>/dev/null; echo '0 2 * * * sqlite3 /opt/petrol-app/data.db ".backup ~/backups/data-$(date +\%F).db"' ) | crontab -
```

Keep copies somewhere off the VM too (your computer or Google Drive).

## Good to know

- Business data is saved as one shared record. If two people save at nearly the same time, the second sees a "Data changed elsewhere" message and reloads. Worker credit sales are separate, so they never clash.
- After 5 wrong passwords, that mobile number is locked for 15 minutes.
- Forgot the owner password? Stop the server, then run:
  ```bash
  node -e "const {openDatabase}=require('./sqlite-adapter'),b=require('bcryptjs'); openDatabase('data.db').then(db=>{ db.prepare('update users set hash=? where role=\\'owner\\'').run(b.hashSync('NewPass123',10)); db.saveNow(); console.log('Password reset to NewPass123'); })"
  ```
  and log in with `NewPass123`, then change it.
