# MC Connector

Makes your Minecraft Bedrock server appear in the Xbox friends tab so players can join with one click — no IP address needed.

## How it works

Logs in to Xbox Live with your Microsoft account(s), creates a game session in Xbox's session directory, and keeps it updated with live player counts from your server. Friends see you "playing" and can click **Join** directly.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Edit `config.json`

```json
{
  "server": {
    "ip": "23.160.168.194",
    "port": 19132,
    "name": "My MC Server",
    "motd": "Join via the friends tab!",
    "maxPlayers": 20
  },
  "accounts": [
    "your-xbox-email@outlook.com"
  ],
  "autoFriend": true,
  "pingInterval": 15000,
  "tokenPath": "./tokens"
}
```

| Field | What it does |
|---|---|
| `server.ip` | Your server's IP address |
| `server.port` | UDP port (default `19132`) |
| `server.name` | Display name shown in friends tab |
| `server.motd` | Subtitle / world name shown |
| `server.maxPlayers` | Max player count displayed |
| `accounts` | List of Microsoft/Xbox email addresses to use |
| `autoFriend` | Automatically friend-back followers every 30 s |
| `pingInterval` | How often (ms) to ping the server for live player count |
| `tokenPath` | Where to cache login tokens (keep this safe!) |

More accounts = more of your friends can see the session simultaneously.

### 3. Run

```bash
npm start
```

The **first time** you run it, a link and a code will be printed in the terminal. Open the link in a browser, enter the code, and sign in with each Microsoft account. Tokens are cached in `./tokens/` so you only need to do this once per account.

### 4. Join

In Minecraft Bedrock, open the **Friends** tab. The server will appear under the signed-in account as an active game session. Tap/click **Join**.

## Requirements

- Node.js 20 or newer
- A Microsoft account that is friends with (or followed by) the players who want to join
- Your Minecraft Bedrock server must be reachable on `23.160.168.194:19132`

## Customisation tips

- Add multiple emails to `accounts` to let more friends join at once
- Set `autoFriend: false` if you want to manage the friend list manually
- Lower `pingInterval` (e.g. `5000`) for more responsive player-count updates; raise it to reduce server load
