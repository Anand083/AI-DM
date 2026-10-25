# Operations

Everything here runs on the server as the `deploy` user, in `~/app`, unless it says otherwise.
Shortcut for the long compose command: `alias dc='docker compose -f docker-compose.prod.yml --env-file .env'`.

## Deploy

Run the **Deploy** workflow in GitHub (Actions tab). See `docs/DEPLOY.md`. It pulls the images, migrates, starts the stack and runs the smoke test.

## Roll back

Run the Deploy workflow again with the full SHA of the older version. A failed smoke test already rolls back by itself. The database is not rolled back, so migrations must keep the previous version working.

By hand: `scripts/deploy.sh <older-sha>`.

## Status and logs

- `dc ps` shows each service and whether it is healthy.
- `dc logs --tail 200 -f web` (or `worker`, `caddy`, `postgres`). Logs rotate (10 MB x 3 files per container).
- Health page: `https://<your-address>/api/health`.
- Uptime monitoring: add the health URL to a free monitor (for example UptimeRobot or Better Stack), check every 5 minutes, alert by email. This is a manual step in their website.
- Failed background jobs: sign in as super admin, open Admin, Queues.

## Backups

- The `backup` container writes a compressed dump of the database every night at 02:00 UTC to the `backups` volume and keeps the newest 3 (`BACKUP_KEEP`).
- At 02:30 UTC the worker copies the newest dump to the S3 bucket, under `backups/`. This turns on when `S3_BUCKET`, `AWS_REGION` and `BACKUP_DIR` are set (the compose file sets `BACKUP_DIR`). If it fails, the job shows as failed in Admin, Queues.
- Take one now: `dc exec backup sh /backup.sh once`.
- **Bucket rule (one time, in the AWS console):** S3, your bucket, Management, Lifecycle rule. Prefix `backups/`, expire current versions after 14 days. Block all public access. Give the EC2 role only `s3:PutObject` on `arn:aws:s3:::<bucket>/backups/*`.
- Uploaded files (logos, PDFs) live in the `storage` volume; back that volume up too, or use `STORAGE_PROVIDER=s3`.

## Restore

Always restore into a new database first and look at it.

1. Get a dump: the newest file in the `backups` volume, or download one from S3.
   `docker run --rm -v ai-dm_backups:/b alpine ls -l /b` (the volume name starts with your folder name).
2. Test it: `scripts/restore-test.sh <dump> <live-database-url>` creates a temporary database, restores into it, compares the row count of every table with the live database, and drops it. It needs the `psql` and `pg_restore` programs and a reachable database; on the server run it from a container: `dc exec -T postgres sh` with the same commands, or copy the dump to your laptop and tunnel port 5432.
3. Real recovery (the live database is lost or damaged):
   1. `dc stop web worker`
   2. Restore: `dc exec -T postgres pg_restore -U app -d app --no-owner --clean --if-exists < dump`
   3. `dc up -d`
   4. Run the smoke test.

Tested for Step 26: dump, restore into a fresh database, all 37 table counts matched (`scripts/restore-test.sh`).

## Rotate secrets

Edit `.env` on the server, then `dc up -d` (containers restart with new values).

- `BETTER_AUTH_SECRET`: everyone is signed out. Existing share links keep working.
- `POSTGRES_PASSWORD`: also change it inside Postgres first: `dc exec postgres psql -U app -c "alter user app password 'NEW'"`, then edit `.env`, then `dc up -d`.
- `ENCRYPTION_KEY`: do not rotate once OAuth tokens are stored (Step 31) without a re-encryption plan.
- `GHCR_READ_TOKEN` and `DEPLOY_SSH_KEY`: change the GitHub secret; for the key also replace the line in `~deploy/.ssh/authorized_keys`.

## Disk space

- `df -h /` and `docker system df`.
- `docker image prune -af` removes old images (the deploy script already prunes dangling ones).
- `docker builder prune -af` (only if you ever built on the server; you should not).
- Logs rotate by themselves. The `backups` volume holds at most 3 dumps.
- Large `storage` volume: old data exports are deleted after 7 days by the daily clean-up.

## Reboot

Everything restarts by itself (`restart: unless-stopped` and Docker starts at boot). Check with `dc ps` after about two minutes.

## Error tracking (optional)

`SENTRY_DSN` is read but not used yet: the Sentry package is not on the approved dependency list. Ask the founder before adding it.
