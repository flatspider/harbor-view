# HAR-51: CI/CD pipeline + Postgres database for Harbor Watch

## Scope
Add GitHub Actions CI/CD for automated deployment on push to main, plus RDS Postgres for vessel position persistence.

## Steps
1. Security cleanup: add `*.pem` to `.gitignore`, `git rm --cached harbor-watch-key.pem`
2. Set GitHub Secrets via `gh secret set` (AWS creds, ECR info, EC2 host, SSH key, AISSTREAM key)
3. Create `.github/workflows/deploy.yml` — build Docker, push ECR, SSH deploy to EC2
4. Create RDS Postgres instance (db.t4g.micro, Postgres 16, private subnet, encrypted)
5. Run schema SQL on RDS via EC2 psql
6. Wire Postgres into server.ts: connection pool, buffered position writes, health check update
7. Add DATABASE_URL secret and update deploy workflow to pass it to container

## Key Files
- `.gitignore` — add `*.pem`
- `.github/workflows/deploy.yml` — new
- `server.ts` — Postgres client, position buffer, health check
- `package.json` — add `postgres` dependency

## Acceptance Criteria
- Push to main triggers automated build + deploy
- `/api/health` reports database connected
- vessel_positions table accumulates rows over time
