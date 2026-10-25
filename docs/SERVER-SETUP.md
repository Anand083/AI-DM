# Server setup (AWS)

Do these in order. Steps 1 to 6 are done by you in the AWS console. The script does the rest.

1. **Budget first.** Billing, Budgets, create a budget with alerts at $5, $10 and $20 sent to your email.
2. **Region.** Pick the region closest to your customers.
3. **Launch an EC2 instance.** Ubuntu 24.04 LTS, `t3.small` (2 GB RAM, recommended). `t3.micro` (1 GB) only with swap and it will be tight. 30 GB gp3 disk.
4. **Elastic IP.** Allocate one and attach it to the instance, so the address never changes. A public IPv4 address has a small hourly charge.
5. **Security group.** SSH (22) from your own IP only. HTTP (80) and HTTPS (443) from anywhere.
6. **SSH key for deploys.** On your own computer: `ssh-keygen -t ed25519 -f deploy_key -C github-deploy`. Keep `deploy_key` private (it goes into the GitHub secret `DEPLOY_SSH_KEY`). The `.pub` file goes to the server.
7. **Run the setup script.** Log in with the key AWS gave you (user `ubuntu`), then:
   ```bash
   sudo DEPLOY_PUBKEY="$(cat deploy_key.pub contents here)" bash server-setup.sh
   ```
   Copy `scripts/server-setup.sh` to the server first (`scp`). Keep your first session open. In a second terminal check that `ssh -i deploy_key deploy@<elastic-ip>` works before you close the first one.
8. **Address for HTTPS without a domain.** Use `<elastic-ip-with-dashes>.sslip.io`, for example `203-0-113-10.sslip.io`. Set `APP_URL=https://203-0-113-10.sslip.io`, `SITE_ADDRESS=203-0-113-10.sslip.io`, and `BETTER_AUTH_URL` to the same URL in the server `.env`. Caddy then gets a certificate by itself. If that fails, use plain HTTP on the IP with `COOKIE_SECURE=false` for testing only, with demo data only, never real customer data.
9. **Server `.env`.** Copy `.env.prod.example` to `/home/deploy/app/.env` and fill it in (secrets: `openssl rand -hex 32`).
10. **GitHub.** Add the secrets listed in `docs/DEPLOY.md`, then run the **Deploy** workflow.

## Checks

- `scripts/smoke-test.sh https://<your-address>` passes (the Deploy workflow runs it for you).
- Reboot the server (`sudo reboot`). After about two minutes the site must answer again with no action from you.
