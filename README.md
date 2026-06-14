# do-ddns

A tiny dependency-free Dynamic DNS service for DigitalOcean's nameservers.

Every 5 minutes it checks your public IP via [ipify](https://www.ipify.org/).
When the IP changes it looks up the matching `A` record for each configured host
and `PUT`s the new IP to the DigitalOcean DNS API. The last-known IP is kept in
memory and re-checked each cycle, so the API is only written to on a real change.

## Setup

1. Requires **Node.js 20.12+** (uses the built-in `fetch` and `.env` loader — no `npm install` needed).
2. Create your env file and add a DigitalOcean API token:
   ```bash
   cp .env.example .env
   # edit .env and set DO_API_KEY
   ```
   Create the token at <https://cloud.digitalocean.com/account/api/tokens> with **read + write** scope.
3. List the hosts to keep updated in `domains.json`:
   ```json
   [
     { "name": "api", "domain": "iabdo.me" },
     { "name": "vpn", "domain": "example.com" }
   ]
   ```
   Use `"@"` as the `name` to update the apex/root record of a domain.
   The `A` records must already exist in DigitalOcean.

## Run

```bash
npm start
```

`domains.json` is re-read every cycle, so you can edit it without restarting.

## Run as a service (systemd)

```ini
# /etc/systemd/system/do-ddns.service
[Unit]
Description=DigitalOcean DDNS
After=network-online.target

[Service]
WorkingDirectory=/path/to/do-ddns
ExecStart=/usr/bin/node index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now do-ddns
```
