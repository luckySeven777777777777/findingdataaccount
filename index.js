// index.js
import { Telegraf } from 'telegraf'
import XLSX from 'xlsx'
import fs from 'fs'

// ===== Bot Setup =====
const bot = new Telegraf(process.env.BOT_TOKEN)

// ===== In-memory store (Railway safe) =====
const store = new Map()

// ===== History store (global, preload) =====
store.set('HISTORY', {
  phones: new Set(),
  users: new Set()
})

// ===== Utility Functions =====
function normalizePhone(p) {
  return p.replace(/\D/g, '')
}

const today = () => new Date().toISOString().slice(0,10)
const month = () => new Date().toISOString().slice(0,7)

const extractPhones = t => t.match(/\b\d{7,15}\b/g) || []
const extractMentions = t => t.match(/@[a-zA-Z0-9_]{3,32}/g) || []

function getUser(chatId, userId) {
  const key = `${chatId}:${userId}`
  if (!store.has(key)) {
    store.set(key, {
      day: today(),
      month: month(),
      phonesDay: new Set(),
      usersDay: new Set(),
      phonesMonth: new Set(),
      usersMonth: new Set()
    })
  }
  return store.get(key)
}

async function isAdmin(ctx) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
    return ['creator', 'administrator'].includes(m.status)
  } catch {
    return false
  }
}

// ===== Preload History from File =====
function preloadHistory(file = 'history.txt') {
  if (!fs.existsSync(file)) {
    console.log('⚠️ history.txt not found, skip preload')
    return
  }

  const text = fs.readFileSync(file, 'utf8')

  const rawPhones = text.match(/[\+]?[\d\-\s]{7,}/g) || []
  const rawUsers = text.match(/@[a-zA-Z0-9_]{3,32}/g) || []

  const history = store.get('HISTORY')

  rawPhones.forEach(p => {
    const n = normalizePhone(p)
    if (n.length >= 7) history.phones.add(n)
  })

  rawUsers.forEach(u => history.users.add(u.toLowerCase()))

  console.log(
    `📚 History loaded: ${history.phones.size} phones, ${history.users.size} usernames`
  )
}

// ===== Message Listener =====
bot.on('text', async ctx => {
  const text = ctx.message.text
  const data = getUser(ctx.chat.id, ctx.from.id)
  const history = store.get('HISTORY')

  // ===== Reset logic =====
  if (data.day !== today()) {
    data.day = today()
    data.phonesDay.clear()
    data.usersDay.clear()
  }

  if (data.month !== month()) {
    data.month = month()
    data.phonesMonth.clear()
    data.usersMonth.clear()
  }

  // ===== Extract =====
  const phones = extractPhones(text)
  const users = extractMentions(text)

  let dupCount = 0
  let dupList = []

  // ===== Track owners with IDs =====
  if (!history.phoneOwners) history.phoneOwners = new Map() // phone -> Set of user IDs
  if (!history.userOwners) history.userOwners = new Map()   // username -> Set of user IDs
  if (!history.userNames) history.userNames = new Map()     // user ID -> displayName

  const displayName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Unknown')
  history.userNames.set(ctx.from.id, displayName)

  // ===== Process phones =====
  phones.forEach(p => {
    const np = normalizePhone(p)
    const owners = history.phoneOwners.get(np) || new Set()
    owners.add(ctx.from.id)
    history.phoneOwners.set(np, owners)
    if (!history.phones.has(np)) {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
    } else {
      dupCount++
      dupList.push(np)
    }
  })

  // ===== Process usernames =====
  users.forEach(u => {
    const nu = u.toLowerCase()
    const owners = history.userOwners.get(nu) || new Set()
    owners.add(ctx.from.id)
    history.userOwners.set(nu, owners)
    if (!history.users.has(nu)) {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)
    } else {
      dupCount++
      dupList.push(nu)
    }
  })

  // ===== Build duplicate owner message =====
  let dupOwners = []

  phones.forEach(p => {
    const np = normalizePhone(p)
    const owners = history.phoneOwners.get(np)
    if (owners && owners.size > 1) {
      const others = [...owners].filter(id => id !== ctx.from.id)
      if (others.length) {
        const names = others.map(id => history.userNames.get(id) || 'Unknown')
        dupOwners.push(`⚠️ ${displayName} you are sharing number ${np} with ${names.join(', ')}`)
      }
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    const owners = history.userOwners.get(nu)
    if (owners && owners.size > 1) {
      const others = [...owners].filter(id => id !== ctx.from.id)
      if (others.length) {
        const names = others.map(id => history.userNames.get(id) || 'Unknown')
        dupOwners.push(`⚠️ ${displayName} you are sharing @${nu} with ${names.join(', ')}`)
      }
    }
  })

  // ===== Auto reply =====
  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

  const msg =
`👤 User: ${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''} ${ctx.from.id}
📝 Duplicate: ${dupCount ? `⚠️ ${dupList.join(', ')} (${dupCount})` : 'None'}
📱 Phone Numbers Today: ${data.phonesDay.size}
@ Username Count Today: ${data.usersDay.size}
📈 Daily Increase: ${data.phonesDay.size + data.usersDay.size}
📊 Monthly Total: ${data.phonesMonth.size + data.usersMonth.size}
📅 Time: ${now}
${dupOwners.length ? dupOwners.join('\n') : ''}`

  await ctx.reply(msg)
})

// ===== Export (Admin Only) =====
bot.command('export', async ctx => {
  if (!(await isAdmin(ctx))) return ctx.reply('❌ Admin only')

  const rows = []
  for (const [k, v] of store.entries()) {
    if (k === 'HISTORY') continue
    rows.push({
      key: k,
      phones_month: v.phonesMonth.size,
      users_month: v.usersMonth.size
    })
  }

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'stats')
  const file = 'export.xlsx'
  XLSX.writeFile(wb, file)
  await ctx.replyWithDocument({ source: file })
})

// ===== Start Bot =====
preloadHistory()
bot.launch()
console.log('✅ Bot running on Railway')
