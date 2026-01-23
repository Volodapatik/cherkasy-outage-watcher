# Cherkasy Outage Watcher

Tracks outage schedules from a Telegram channel, stores history, and serves a small UI with Web Push notifications.

## Commands

- `npm run dev` — run locally with auto-reload
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — start compiled server from `dist/`

## Web Push setup

1) Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

2) Add the values to environment variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (example: `mailto:me@example.com`)

3) Deploy (Railway example): add the same variables in the Railway dashboard.

4) Visit the site and open the settings panel → enable notifications.

### Test push (development only)

```bash
curl -X POST http://localhost:3000/api/push/test
```

## Notes

- Timestamps are rendered in the `Europe/Kyiv` timezone.
- First visit requires opening the settings panel and enabling notifications.
- For Android Chrome, make sure the site is allowed in notification settings.

