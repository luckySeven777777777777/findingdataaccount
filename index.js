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

  // ===== Track owners (new) =====
  if (!history.phoneOwners) history.phoneOwners = new Map() // phone -> Set of names
  if (!history.userOwners) history.userOwners = new Map()   // username -> Set of names

  phones.forEach(p => {
    const np = normalizePhone(p)
    if (history.phones.has(np) || data.phonesMonth.has(np)) {
      dupCount++
      dupList.push(np)
      const owners = history.phoneOwners.get(np) || new Set()
      owners.add(ctx.from.first_name || 'Unknown')
      history.phoneOwners.set(np, owners)
    } else {
      data.phonesDay.add(np)
      data.phonesMonth.add(np)
      history.phones.add(np)
      history.phoneOwners.set(np, new Set([ctx.from.first_name || 'Unknown']))
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    if (history.users.has(nu) || data.usersMonth.has(nu)) {
      dupCount++
      dupList.push(nu)
      const owners = history.userOwners.get(nu) || new Set()
      owners.add(ctx.from.first_name || 'Unknown')
      history.userOwners.set(nu, owners)
    } else {
      data.usersDay.add(nu)
      data.usersMonth.add(nu)
      history.users.add(nu)
      history.userOwners.set(nu, new Set([ctx.from.first_name || 'Unknown']))
    }
  })

  // ===== Build duplicate owner message =====
  let dupOwners = []

  phones.forEach(p => {
    const np = normalizePhone(p)
    const owners = history.phoneOwners.get(np)
    if (owners && owners.size > 1) {
      const others = [...owners].filter(n => n !== (ctx.from.first_name || 'Unknown'))
      if (others.length)
        dupOwners.push(`⚠️ @${ctx.from.username || ctx.from.first_name} you are sharing number ${np} with ${others.join(', ')}`)
    }
  })

  users.forEach(u => {
    const nu = u.toLowerCase()
    const owners = history.userOwners.get(nu)
    if (owners && owners.size > 1) {
      const others = [...owners].filter(n => n !== (ctx.from.first_name || 'Unknown'))
      if (others.length)
        dupOwners.push(`⚠️ @${ctx.from.username || ctx.from.first_name} you are sharing @${nu} with ${others.join(', ')}`)
    }
  })

  // ===== Auto reply =====
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Yangon'
  })

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
