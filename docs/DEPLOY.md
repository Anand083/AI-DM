# Deploying

Images are built by GitHub Actions, never on the server.

## How it flows

1. You push to `main`.
2. The `CI` workflow runs lint, typecheck, unit and integration tests, E2E tests, the security audit and the secret scan.
3. If all pass, the `images` job builds the `web` and `worker` images and pushes them to GitHub Container Registry as `ghcr.io/<owner>/<repo>-web` and `-worker`, tagged with the git SHA and `latest`.
4. You start the **Deploy** workflow by hand (Actions tab, Deploy, Run workflow). Leave the SHA empty for the newest commit on `main`, or paste a full SHA to deploy or roll back to a specific version.
5. The workflow copies the compose file and scripts to the server, then runs `scripts/deploy.sh <sha>` there. That script pulls the images, runs migrations, starts the stack, runs the smoke test, and goes back to the previous version if the smoke test fails. The workflow shows as failed when a rollback happened.

## GitHub settings you must create (Step 25 explains the server side)

Create an environment named `production` (Settings, Environments). Add these secrets to it:

| Secret               | What it is                                                                           |
| -------------------- | ------------------------------------------------------------------------------------ |
| `DEPLOY_HOST`        | Server address (the Elastic IP)                                                      |
| `DEPLOY_USER`        | The deploy user created by `scripts/server-setup.sh`                                 |
| `DEPLOY_SSH_KEY`     | Private key for that user. Make a key only for this.                                 |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <host>`, run from your own machine                 |
| `GHCR_READ_USER`     | Your GitHub user name                                                                |
| `GHCR_READ_TOKEN`    | A personal access token with only `read:packages`, so the server can pull the images |

Optional variable `DEPLOY_PATH` (default `app`, relative to the deploy user's home folder).

The server keeps its own `.env` in the app folder (copy `.env.prod.example`). It never goes to GitHub.

## Database changes and rollback

Rollback changes the app version, not the database. So every migration must work with the previous version too: add columns and tables first, remove old ones in a later release.

## Proving the rollback works

On any machine with Docker: `DEPLOY_FORCE_SMOKE_FAIL=1 SKIP_PULL=1 SMOKE_URL=http://localhost scripts/deploy.sh <tag>` forces a failed smoke test and should end on the previous version. This was tested once locally for Step 24.
