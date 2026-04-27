/**
 * McSession — advertises a Bedrock server as an Xbox Live game session so
 * friends can join directly through the in-game friends tab.
 *
 * Flow:
 *  1. Authenticate via Microsoft device-code flow (first run opens a browser link)
 *  2. Open an RTA WebSocket to Xbox Live to get a ConnectionId
 *  3. PUT a Minecraft session to the Xbox Session Directory API
 *  4. Ping the real server every N seconds to keep player counts fresh
 *  5. Optionally auto-friend followers so they can see the session
 */

'use strict'

const https = require('https')
const { v4: uuidv4 } = require('uuid')
const WebSocket = require('ws')
const { Authflow, Titles } = require('prismarine-auth')

// ── Xbox Live constants for Minecraft Bedrock ─────────────────────────────────
const SCID = '4fc10100-5f7a-4470-899b-280835760c07'
const TEMPLATE = 'MinecraftLobby'
const RTA_URL = 'wss://rta.xboxlive.com/connect'
const RTA_SUB_PATH = 'https://sessiondirectory.xboxlive.com/connections/'

class McSession {
  constructor (config, email) {
    this.config = config
    this.email = email
    this.sessionName = uuidv4()
    this.subscriptionId = uuidv4()
    this.connectionId = null
    this.xuid = null

    // Cached tokens keyed by relying party
    this._tokens = {}
    this._authflow = null

    // Live server info (updated on every ping)
    this.serverInfo = {
      name: config.server.name || 'MC Server',
      motd: config.server.motd || 'A Minecraft Server',
      playerCount: 0,
      maxPlayers: config.server.maxPlayers || 20,
      protocol: 748,       // default — overwritten by first ping
      version: '1.21.80'  // default — overwritten by first ping
    }

    this._ws = null
    this._running = false
  }

  // ── Public entry point ──────────────────────────────────────────────────────

  async start () {
    await this._authenticate()
    await this._connectRTA()
    await this._pingServer()   // populate real version before first session PUT
    await this._createSession()

    this._running = true
    setInterval(() => this._tick(), this.config.pingInterval ?? 15_000)

    if (this.config.autoFriend) {
      setInterval(() => this._addFollowers(), 30_000)
    }

    console.log(`[${this.email}] ✓ Session live — friends can join through the friends tab`)
  }

  // ── Authentication ──────────────────────────────────────────────────────────

  async _authenticate () {
    console.log(`[${this.email}] Authenticating with Xbox Live...`)
    const tokenPath = this.config.tokenPath ?? './tokens'

    this._authflow = new Authflow(this.email, tokenPath, {
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: 'Nintendo',
      flow: 'live'
    })

    // Pre-fetch the tokens we'll need
    await this._token('https://sessiondirectory.xboxlive.com/')
    await this._token('https://xboxlive.com')
    await this._token('https://peoplehub.xboxlive.com')

    // Get XUID from the profile API
    this.xuid = await this._fetchXuid()
    console.log(`[${this.email}] Authenticated — XUID: ${this.xuid}`)
  }

  async _token (relyingParty) {
    if (!this._tokens[relyingParty]) {
      this._tokens[relyingParty] = await this._authflow.getXboxToken(relyingParty)
    }
    return this._tokens[relyingParty]
  }

  _authHeader (token) {
    return `XBL3.0 x=${token.userHash};${token.XSTSToken}`
  }

  async _fetchXuid () {
    // userXUID is sometimes included directly in the token response
    const t = await this._token('https://xboxlive.com')
    if (t.userXUID) return t.userXUID

    // Fallback: query the profile API
    const data = await this._req({
      method: 'GET',
      hostname: 'profile.xboxlive.com',
      path: '/users/me/profile/settings',
      token: t,
      contractVersion: '2'
    })
    return data.profileUsers[0].id
  }

  // ── RTA WebSocket ───────────────────────────────────────────────────────────

  async _connectRTA () {
    const t = await this._token('https://sessiondirectory.xboxlive.com/')

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(RTA_URL, { headers: { Authorization: this._authHeader(t) } })
      this._ws = ws

      const timeout = setTimeout(() => reject(new Error('RTA connect timeout')), 15_000)

      ws.once('open', () => {
        // Subscribe message: [type=1, reqId, subscriptionPath]
        ws.send(JSON.stringify([1, 1, RTA_SUB_PATH]))
      })

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        // Response: [type=2, reqId, null, {ConnectionId}, null]
        if (msg[0] === 2 && msg[1] === 1) {
          clearTimeout(timeout)
          this.connectionId = msg[3].ConnectionId
          console.log(`[${this.email}] RTA connected — ConnectionId: ${this.connectionId}`)
          resolve()
        }
      })

      ws.on('error', (err) => { clearTimeout(timeout); reject(err) })

      ws.on('close', () => {
        if (this._running) {
          console.log(`[${this.email}] RTA dropped — reconnecting in 5 s…`)
          setTimeout(() => this._connectRTA().then(() => this._createSession()).catch(console.error), 5_000)
        }
      })
    })
  }

  // ── Xbox Session Directory ──────────────────────────────────────────────────

  async _createSession () {
    const { ip, port } = this.config.server
    const { name, motd, playerCount, maxPlayers, protocol, version } = this.serverInfo

    const body = {
      properties: {
        system: {
          joinRestriction: 'followed',
          readRestriction: 'followed',
          closed: false
        },
        custom: {
          BroadcastSetting: 3,
          CrossPlayDisabled: false,
          Joinability: 'joinable_by_friends',
          LanGame: true,
          MaxMemberCount: maxPlayers,
          MemberCount: playerCount,
          OnlineCrossPlatformGame: true,
          SupportedConnections: [{
            ConnectionType: 6,   // 6 = internet / direct IP
            HostIpAddress: ip,
            HostPort: port,
            RakNetGUID: ''
          }],
          TitleId: 0,
          TransportLayer: 0,
          levelId: 'level',
          hostName: name,
          ownerId: this.xuid,
          rakNetGUID: '',
          worldName: motd,
          worldType: 'Survival',
          protocol,
          version
        }
      },
      members: {
        me: {
          constants: {
            system: { xuid: this.xuid, initialize: true }
          },
          properties: {
            system: {
              active: true,
              connection: this.connectionId,
              subscription: {
                id: this.subscriptionId,
                changeTypes: ['everything']
              }
            }
          }
        }
      }
    }

    const t = await this._token('https://sessiondirectory.xboxlive.com/')
    await this._req({
      method: 'PUT',
      hostname: 'sessiondirectory.xboxlive.com',
      path: `/serviceconfigs/${SCID}/sessionTemplates/${TEMPLATE}/sessions/${this.sessionName}`,
      token: t,
      body
    })
  }

  // ── Server ping ─────────────────────────────────────────────────────────────

  async _pingServer () {
    try {
      const { ping } = require('bedrock-protocol')
      const { ip, port } = this.config.server
      const info = await ping({ host: ip, port })

      this.serverInfo.playerCount = info.playersOnline ?? this.serverInfo.playerCount
      this.serverInfo.maxPlayers  = info.playersMax    ?? this.serverInfo.maxPlayers
      this.serverInfo.protocol    = info.protocol      ?? this.serverInfo.protocol
      this.serverInfo.version     = info.version       ?? this.serverInfo.version
    } catch {
      // Server temporarily unreachable — keep last known values
    }
  }

  // ── Auto-friend followers ───────────────────────────────────────────────────

  async _addFollowers () {
    try {
      const t = await this._token('https://peoplehub.xboxlive.com')
      const data = await this._req({
        method: 'GET',
        hostname: 'peoplehub.xboxlive.com',
        path: '/users/me/people/followers?maxItems=100&decoration=detail',
        token: t,
        contractVersion: '4'
      })

      const xuids = (data?.people ?? []).map(p => p.xuid)
      const social = await this._token('https://social.xboxlive.com')

      for (const xuid of xuids) {
        try {
          await this._req({
            method: 'PUT',
            hostname: 'social.xboxlive.com',
            path: `/users/me/people/xuid(${xuid})`,
            token: social,
            contractVersion: '1'
          })
        } catch { /* already friends or rate limited */ }
      }
    } catch (err) {
      console.error(`[${this.email}] Auto-friend error:`, err.message)
    }
  }

  // ── Periodic tick ───────────────────────────────────────────────────────────

  async _tick () {
    await this._pingServer()
    await this._createSession().catch(err => {
      console.error(`[${this.email}] Session update error:`, err.message)
    })
  }

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  _req ({ method, hostname, path, token, body = null, contractVersion = '107' }) {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null
      const headers = {
        Authorization: this._authHeader(token),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-xbl-contract-version': contractVersion,
        'Accept-Language': 'en-US'
      }
      if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr)

      const req = https.request({ hostname, path, method, headers }, (res) => {
        let raw = ''
        res.on('data', c => { raw += c })
        res.on('end', () => {
          try { resolve(raw ? JSON.parse(raw) : null) }
          catch { resolve(raw) }
        })
      })
      req.on('error', reject)
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }
}

module.exports = McSession
