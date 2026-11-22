# Red Mini Bot

Red Mini is an Express dashboard and WhatsApp bot. The dashboard and API run on the same server: `/status` is the control center, `/pair` generates a WhatsApp pairing code, and `/api/status` reports health.

## Quick start: no Supabase required

Supabase is optional. By default, Red Mini stores WhatsApp credentials, Signal keys, linked numbers, settings, admins, and newsletters in the local `DATA_DIR` directory. Pair once, keep that directory persistent, and the bot restores the linked session after a restart.

1. Use Node.js 22 or newer and install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`. The important setting is `DATA_DIR=./data`.
3. Start with `node --env-file=.env index.js` or `npm start`.
4. Open `/pair`, enter the full WhatsApp number with country code, and enter the generated code in WhatsApp under **Linked devices → Link a device → Link with phone number**.
5. After linking, the bot is ready for commands. The linked device appears as a Safari/macOS web session.

Keep `DATA_DIR` private. It contains WhatsApp session credentials and Signal keys. Do not commit, upload, or share it. Use HTTPS and protect the open dashboard with a private URL, reverse-proxy authentication, VPN, or network rules before public exposure.

## Deployment choices

### Railway

Railway is convenient for a quick developer deployment and automatically provides `PORT`. The local filesystem is not a permanent backup unless a persistent volume is attached. Attach a volume and set `DATA_DIR` to its mounted path, then redeploy. Without a volume, the bot can pair and run, but a container replacement may require pairing again.

### Render

Render works with a Node web service using `npm start`. Use a persistent disk and set `DATA_DIR` to the disk mount path. A free or ephemeral instance should be treated as disposable: the bot can run, but its local WhatsApp session may disappear after a rebuild or restart. Render’s HTTPS URL is suitable for the dashboard once access controls are added.

### Pterodactyl panels

Pterodactyl is a strong choice when you want the session files to remain on the server. Create a Node.js server, upload the repository, run `npm ci`, set the startup command to `npm start`, and allocate the server port. Set `DATA_DIR=./data` or another writable directory inside the server. The panel’s persistent server filesystem keeps the pairing credentials across normal restarts. Back up the `data` directory securely.

For any platform, run only one bot instance against one `DATA_DIR`. Multiple instances can overwrite credentials or compete for the same WhatsApp session.

## Optional Supabase mode

Supabase remains supported for operators who need shared persistence across instances. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, run [`schema.sql`](schema.sql), and the bot automatically uses Supabase instead of local JSON/files. It is not required for pairing or ordinary single-instance deployments.

## Configuration

Set `OWNER_NUMBER` to an international phone number with digits only if you want instance-wide owner commands. Set `IMAGE_THEME=Redragon` to choose the default menu, ping, and welcome artwork. Set `WELCOME_MESSAGE` to customize the text sent when members join a group; it defaults to `Enjoy the group.`. The owner can run `.imagetheme` to list themes or `.imagetheme Goku` to switch artwork during the current process. Music uses a five-provider fallback through `.music <song or artist>`: Audius, SoundCloud, Jamendo, Spotify, and Apple Music. Provider-specific commands are `.audius`, `.soundcloud`, `.jamendo`, `.spotify`, and `.applemusic`. Empty provider credentials are skipped automatically.

Audius, SoundCloud, and Jamendo may return playable provider media when the response and licensing permit it. Spotify and Apple Music are catalog/link providers; they do not provide a general full-song MP3 API. The bot sends an official link or preview when full media is not available instead of pretending the download succeeded. Configure provider credentials in `.env` or your hosting environment; never commit them.

Group administrators can use `.kick`, `.kickall`, `.mute`, `.open`, and `.adddescription`. `.addstgroup <text>` sends a RED XMD status card to the current group, while the owner can use `.addstchannel <text>` with `NEWSLETTER_JID` configured. `.tgstickers <direct image URL>` converts a direct sticker image into a WhatsApp sticker. Media conversion commands are `.to-url`, `.to-doc`, `.to-music`, and `.to-sticker`; reply to the media when using them. `.spotify <song>` searches Spotify when Spotify credentials are configured. `.update` is an owner-only repository version checker: it reports new commits and tells each deployment owner to pull and restart safely; it never changes a running deployment remotely.

Automatic status viewing is enabled by default. The owner can run `.statusview` to inspect it, `.statusview on` or `.statusview off` to toggle viewing, `.statusview like on|off` to control reactions, and `.statusview emojis ❤️ 💗 🔥 🥰` to set the reaction list. The bot uses `❤️`, `💗`, `🔥`, and `🥰` by default.

Movie search is available with `.movie <title>` or `.movies <title>` when `TMDB_API_KEY` is configured. Searches run in a bounded background queue with short timeouts and five-minute caching, so they do not block other commands. Results include official TMDB title pages; the bot does not download large or unauthorized movie files.

The safe Omegatech commands are `.songsearch <lyrics or song>`, `.trending`, `.ceenaija <song or artist>`, `.anime <title>`, `.ytdl <YouTube URL>` for metadata, `.ytvideo <YouTube URL>`, and `.ytaudio <YouTube URL>`. `.play <song or artist>` searches YouTube through the lightweight Axios/Cheerio adapter in `lib/youtube-search.js`, selects the first video result, and requests an MP3 from the Keith download endpoint; the returned temporary URL is sent as an MPEG audio file and is never stored. Music commands send audio directly without button payloads. Missing queries, empty search results, provider failures, and download failures are returned using the compact Red Dragon text layout. These commands use short request timeouts and display official/source links where available. YouTube video delivery is capped at 50 MB and prefers an available format under that limit. `.fb` and `.facebook` also support the Omegatech `data.directUrl` response with the existing provider as fallback.

The bot does not expose the Omegatech Netflix token generator or external VIP reaction queue. The supplied AI-song status endpoint and Akinator start endpoint are also not registered because their creation/answer continuation requests were not provided; registering incomplete commands would leave users with broken flows. Configure `OMEGATECH_API_BASE` or `FACEBOOK_API_ENDPOINT` only when using an authorized provider endpoint.

Image themes are stored in [`image-themes.json`](image-themes.json). The owner can run `.imagetheme` to list them or `.imagetheme <name>` to switch the artwork used for menu, ping, welcome, and alive responses. Image theme selection is the only theme system; outgoing text and media captions use the fixed compact RedDragon formatter.

## HTTP endpoints

- `GET /status` — dashboard.
- `GET /pair` — pairing form.
- `GET /api/status` — service health, storage mode, and masked linked sessions.
- `POST /code` — request a pairing code with JSON `{ "number": "27634988678" }`.
- `POST /code/connect-all` — reconnect saved local or Supabase sessions.

## Verification

Run `npm run check` and `npm test`. The tests cover HTML parsing, pairing and reconnect routes, local/Supabase auth persistence, plugins, command smoke paths, and response formatting.
