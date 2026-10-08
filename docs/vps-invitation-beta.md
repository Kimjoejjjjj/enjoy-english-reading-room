# VPS invitation beta runbook

This runbook is preparation only. A real schema sync, email send, storage migration, or deployment still requires its own approval and verified backup.

## Runtime contract

- Run exactly one Next.js application process against the SQLite file.
- Put the database and private files on the same persistent volume, for example `/srv/enjoy-english/data`.
- Set `DATABASE_URL=file:/srv/enjoy-english/data/enjoy.db` and `APP_DATA_DIR=/srv/enjoy-english/data`.
- Set unique secrets of at least 32 characters for `JWT_SECRET` and `OTP_HASH_SECRET`.
- Set `LOGIN_ALLOWED_EMAILS` to a comma-separated, lowercase invitation list.
- Configure `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, `TRUST_PROXY_HOPS=1`, and `AI_QUOTA_ENABLED=false`.
- Keep the environment file readable only by the service account and never copy it into Git or logs.

The server refuses to start in production when these requirements are not met or when the database is outside `APP_DATA_DIR`.

## Reverse proxy requirements

Use HTTPS and make the proxy overwrite, rather than append untrusted client forwarding headers. Equivalent nginx settings are:

```nginx
client_max_body_size 210m;

location ^~ /uploads/books/ {
    return 404;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 310s;
    proxy_send_timeout 310s;
}
```

The process supervisor must use one worker and restart only after a graceful stop. Do not use cluster mode with SQLite.

## Gated schema and storage preparation

1. Stop the verified application writer.
2. Record the exact database path, journal mode, sidecars, upload directory, source revision, Node/Prisma versions, and free disk space.
3. Create a consistent SQLite backup plus a separate archive of uploads, then restore both into an isolated directory.
4. Point Prisma only at the isolated database, verify `PRAGMA database_list`, and apply the additive `EmailLoginCode` table there first. Abort on any destructive-change warning; never use `--accept-data-loss`.
5. Run `node scripts/migrate-private-book-storage.mjs --database <absolute-copy.db> --app-data-dir <absolute-copy-data>` for a read-only preview.
6. After reviewing every source, destination, and SHA-256, repeat with `--apply --confirmed-backup <absolute-existing-backup>` against the isolated copy.
7. Verify book counts, file hashes, authenticated TXT/PDF/EPUB reads, database integrity, foreign keys, and restore behavior.
8. Request separate approval before repeating the reviewed steps against the live database. The migration copies files and changes storage keys but deliberately does not delete legacy files.

## Canary acceptance

Start with one invited email, perform one explicitly authorized Resend delivery, and verify login, refresh, logout, expiry, replay rejection, and rate limits. Add a second account only after cross-account book, highlight, vocabulary, reading-time, settings, AI-credential, and file access all return no foreign data.

Monitor HTTP 5xx, rejected logins, Resend failures, SQLite integrity, disk usage, and backup completion for 24–48 hours before expanding the invitation list.
