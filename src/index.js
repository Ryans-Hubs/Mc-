'use strict'

const { readFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const McSession = require('./session')

const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf-8'))

// Ensure token cache directory exists
mkdirSync(config.tokenPath ?? './tokens', { recursive: true })

const line = '─'.repeat(52)
console.log(line)
console.log('  MC Connector — Friends Tab Server Advertiser')
console.log(line)
console.log(`  Server  : ${config.server.ip}:${config.server.port}`)
console.log(`  Name    : ${config.server.name}`)
console.log(`  Accounts: ${config.accounts.length}`)
console.log(line)

async function main () {
  for (const email of config.accounts) {
    const session = new McSession(config, email)
    try {
      await session.start()
    } catch (err) {
      console.error(`[${email}] Failed to start:\n`, err.stack ?? err.message)
      process.exit(1)
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
