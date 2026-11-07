# FormPigeon

Google Forms → Discord notifications in a single Apps Script file, built on
[Components V2](https://docs.discord.com/developers/components/reference) —
Discord's embed-replacement message format. No hosting, no dependencies, no
cost.

Every response arrives as one clean card: numbered questions, sanitized
answers, real file names, optional pings. Long submissions are split into
`Part 2 of N` cards automatically; edited responses are labeled. A real
example payload lives in [`examples/payload-example.json`](examples/payload-example.json).

## Setup

### 1. Create a Discord webhook

Discord → **Server Settings → Integrations → Webhooks → New Webhook** →
pick the channel → **Copy Webhook URL**.

### 2. Install the script

1. Open your Google Form → **Extensions → Apps Script**. This binds the
   script to the form, which is what enables the Discord menu.
2. Delete the placeholder code, paste the entire contents of
   [`Code.gs`](Code.gs), and fill in your webhook URL:

   ```js
   WEBHOOK_URLS: [
     'https://discord.com/api/webhooks/123456/your-token-here',
   ],
   ```

### 3. Add the manifest (appsscript.json)

This declares the permissions the script needs — including the
external-request permission that POSTs to Discord. Skipping it is the usual
cause of the *"You do not have permission to call UrlFetchApp.fetch"* error.

1. In the Apps Script editor open **Project Settings** (gear icon) and check
   **Show "appsscript.json" manifest file in editor**.
2. Open `appsscript.json` in the editor and replace its whole content with:

   ```json
   {
     "timeZone": "Asia/Shanghai",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/forms",
       "https://www.googleapis.com/auth/script.scriptapp",
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/script.container.ui",
       "https://www.googleapis.com/auth/script.send_mail",
       "https://www.googleapis.com/auth/drive.readonly"
     ]
   }
   ```

3. Save. Adjust `timeZone` if you prefer timestamps in another timezone.

### 4. Authorize and test

1. Select **`menuSendTestMessage`** in the toolbar dropdown and press **Run**.
2. Complete the authorization prompt: **Review permissions → Advanced →
   Go to FormPigeon (unsafe) → Allow**. The "unverified app" warning is
   normal for self-authored scripts.
3. The result appears in the **execution log** at the bottom — a run from
   the editor never opens a popup. Check Discord for the test card
   ("This is a test message.").

### 5. Go live

Reload the **form editor tab**, open the **Discord** menu →
**Install notification trigger**. Submit a real response — the card lands in
Discord within seconds.

## Menu commands

| Command | What it does |
|---|---|
| Send test message | Sends a one-line Components V2 card: "This is a test message." |
| Test webhook connection | For each webhook: shows which channel it posts into and drops a plain-text ping — tells "bad URL", "deleted webhook" and "wrong channel" apart. |
| Check authorization | Probes every permission the script uses, names what is missing and how to fix it. |
| Install / Remove notification trigger | Installs or removes the `onFormSubmit` trigger (duplicates are removed first). |
| Check status | Shows webhook count, trigger state and key settings. |

## Configuration

All options live in `CONFIG` at the top of `Code.gs`. Only `WEBHOOK_URLS` is
required.

| Key | Default | Description |
|---|---|---|
| `WEBHOOK_URLS` | — | **Required.** One or more webhook URLs; each gets every card. |
| `BOT_NAME` | `'FormPigeon'` | Username shown in Discord. `''` keeps the webhook's own name. |
| `AVATAR_URL` | `''` | Webhook avatar image URL. |
| `HEADER_ICON_URL` | Forms logo | Small icon next to the card header. `''` hides it. |
| `MENTION` | `''` | Ping prepended to each card: `'<@&ROLE_ID>'`, `'<@USER_ID>'`, `'@here'`, `'@everyone'`. Copy IDs with Discord Developer Mode. |
| `THREAD_ID` | `''` | Post into a thread / forum post instead of the channel root (required for forum channels). |
| `MARK_EDITED` | `true` | Label re-submitted (edited) responses as *Edited response*. |
| `SHOW_UNANSWERED` | `true` | List blank questions as *No answer given.* |
| `NUMBER_QUESTIONS` | `true` | Prefix questions with `1.` `2.` `3.` |
| `SHOW_RESPONDENT_EMAIL` | `true` | Show the respondent's email when the form collects it. |
| `ESCAPE_MARKDOWN` | `true` | Sanitize markdown typed by respondents. |
| `SHOW_EDIT_LINK` | `true` | Footer link that opens the response in edit mode — anyone with it can edit, so turn it off in public channels. |
| `SHOW_FORM_LINK` | `true` | Footer link to the form dashboard. |
| `RESOLVE_FILE_NAMES` | `true` | Show real uploaded file names (read-only Drive permission). |
| `FILE_THUMBNAILS` | `false` | Render uploads as an image gallery — only works if the files are shared publicly. |
| `MAX_ANSWER_LENGTH` | `800` | Answers longer than this are truncated. |
| `MAX_TEXT_PER_MESSAGE` | `3600` | Pagination threshold (Discord's hard limit is 4,000). |
| `MAX_COMPONENTS` | `34` | Pagination threshold (Discord's hard limit is 40). |
| `EMAIL_ON_ERROR` | `true` | Email the script owner when a delivery fails. |
| `TIMEZONE` | `''` | Timestamp timezone; `''` uses the script timezone. |

## Troubleshooting

Results of editor runs and triggers always appear in the **execution log**
(Executions) — never as a popup.

| Symptom | Fix |
|---|---|
| "You do not have permission to call UrlFetchApp.fetch" | Missing or stale authorization. Check `appsscript.json` contains `script.external_request` (Step 3), save, then run again and complete the dialog. If no dialog appears anymore, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), then run again. `menuCheckAuthorization` prints exactly which permission is missing. |
| Nothing arrives, but no error | Run **Test webhook connection** — it names the channel each webhook posts into. You were probably watching a different channel. |
| HTTP 404 / 401 / 403 | The webhook was deleted or re-created — copy a fresh URL. |
| HTTP 400, forum channel | The webhook belongs to a forum channel. Set `THREAD_ID` or move the webhook to a normal text channel. |
| HTTP 429 | Rate limit — the script retries once automatically. |
| Discord menu is missing | The script isn't bound to the form, or the form tab wasn't reloaded after pasting the code. |
| Log: "started manually from the editor" | You ran `onFormSubmit` directly — expected, nothing to deliver. Use **Send test message** instead. |
| Log: "event arrived without a response payload" | A trigger was created on the linked spreadsheet instead of the form. Remove it via the menu, reinstall. |
| Trigger installed but no card | **Check status** — multiple triggers can stack; the install command removes duplicates first. |
| File names show as "Uploaded file" | `RESOLVE_FILE_NAMES: false`, or the Drive permission wasn't granted — re-run authorization. |
| Thumbnails are broken tiles | `FILE_THUMBNAILS` needs publicly shared files, or turn it off. |
| Time in cards is off | Set `CONFIG.TIMEZONE` or the script timezone in Project Settings. |
| Card shows as plain text | Discord client too old for Components V2 — update the app. |

## Good to know

- **Pings are safe.** `allowed_mentions` is a hard allow-list: respondent
  answers can never ping anyone, even if they type `@everyone`. Only your own
  `MENTION` setting pings.
- **Webhook URL = password.** It lives only in your script's CONFIG; anyone
  holding it can post to your channel.
- **Pagination.** Discord allows 4,000 characters and 40 components per
  message. FormPigeon packs what fits and starts `Part 2 of N` with the rest.
- **Edit detection.** Re-submissions of the same response are labeled
  *Edited response* (rolling memory of the last 120 response IDs).
- **Multiple webhooks / forums / threads.** Add URLs to `WEBHOOK_URLS`; set
  `THREAD_ID` for forum posts and threads.
- **Quizzes, sections and grids** are formatted generically; non-question
  elements (page breaks, images) are skipped.

## Uninstall

Discord menu → **Remove notification trigger**. Optionally delete the Apps
Script project (revokes all authorizations) and the webhook in Discord.

## License

[MIT](LICENSE)
