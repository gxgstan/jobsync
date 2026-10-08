# Personal subscription runner

The Coolify stack builds this runner and the JobSync fork. The runner calls the
unmodified Claude Code and Codex CLIs using the existing Tinyboy sign-ins. It is
private to the Compose network and requires `SUBSCRIPTION_RUNNER_TOKEN` for model
discovery and generation. JobSync never receives the subscription OAuth tokens.

Claude Code runs without native tools, hooks, skills or MCP servers. Codex runs
with a read-only sandbox and shell, execution, web search, plugins, image
generation and additional agents disabled. CLI input is passed on stdin with
fixed argument arrays. Each subscription processes one request at a time, with
four waiting slots, cancellation, an output limit and a three-minute deadline.
There is no fallback to paid API authentication.

Application functions are encoded as structured proposals. The Vercel AI SDK
validates arguments, executes read tools and renders its existing approval cards
before write tools can run. Structured resume import and automation output
retain their original schemas. Replies are buffered until the CLI finishes, then
emitted through the existing SDK stream.

Configure the following in Coolify, as runtime variables:

- `CODEX_ACCOUNT_HOME`: existing managed Codex account home on the Tinyboy host.
- `CLAUDE_ACCOUNT_HOME`: existing Claude credential directory on the host.
- `SUBSCRIPTION_RUNNER_TOKEN`: a random secret of at least 32 characters.
- `AUTH_SECRET`, `ENCRYPTION_KEY`: stable random secrets; retain them with backups.
- `NEXTAUTH_URL`: the browser URL of JobSync.

Only the runner mounts the account directories. Its UID is 1000, matching their
host owner; mounts are writable so the official CLIs can renew credentials.
Reconnect an expired account through its normal Tinyboy/Orca login flow. Avoid
changing `ENCRYPTION_KEY` after storing API credentials in JobSync.

The stack defaults to the Codex account's configured model (`default`). Claude
Code's supported subscription aliases appear under Settings > AI Settings.
`SINGLE_USER_MODE=true` closes sign-up after the first personal account is created.

Development uses Node 24 (`nvm use`), `npm ci`, `npx prisma generate` and an ignored
`.env.local` with a SQLite database URL. Run `npm test`,
`npm run test:subscriptions` and `npm run build` before deploying.

Use `docker-compose.coolify.yml`, not the upstream Compose file, which pulls an
upstream image. `/data` uses a persistent named volume for SQLite and attachments.
Back up through Settings > Data. Redeploying preserves this volume. To roll back,
select the previous working commit in Coolify without deleting storage. Back up
before any future database migration and restore that backup if a rollback also
requires reverting its schema.

The synthetic live smoke test is available inside the app container as
`node /app/subscription-smoke.mjs`. It verifies proposals from both subscriptions
and never saves application data.
