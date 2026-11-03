import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// Create a home
app.post('/api/homes', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, createdAt)
    .run()

  return c.json({ id, name }, 201)
})

// List homes
app.get('/api/homes', async (c) => {
  interface HomeRow {
    id: string
    name: string
    created_at: number
  }

  const homes = await c.env.DB.prepare(
    'SELECT id, name, created_at FROM homes ORDER BY rowid ASC',
  ).all<HomeRow>()

  return c.json({ homes: homes.results ?? [] }, 200)
})

// Get home by ID
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')
  interface HomeRow {
    id: string
    name: string
    created_at: number
  }

  const home = await c.env.DB.prepare('SELECT id, name, created_at FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  return c.json(home, 200)
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const createdAt = Date.now()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, createdAt)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// List members of a home
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  interface MemberRow {
    id: string
    home_id: string
    name: string
  }

  const members = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  return c.json({ members: members.results ?? [] }, 200)
})

// Create a bill in a home
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { title, totalCents } = body

  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole integer' }, 422)
  }

  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Title is required' }, 422)
  }

  interface MemberRow {
    id: string
    name: string
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id, name FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<MemberRow>()

  const members = membersResult.results ?? []
  if (members.length === 0) {
    return c.json({ error: 'Home has no members' }, 422)
  }

  const memberCount = members.length
  const baseShare = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  const billId = crypto.randomUUID()
  const createdAt = Date.now()

  interface ShareResponse {
    id: string
    memberId: string
    amountCents: number
    paidAt: null
  }

  const shares: ShareResponse[] = []
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title.trim(), totalCents, createdAt),
  ]

  for (let i = 0; i < memberCount; i++) {
    const member = members[i]
    if (!member) {
      continue
    }

    const shareId = crypto.randomUUID()
    const amountCents = baseShare + (i < remainder ? 1 : 0)

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, paid_at, idempotency_key) VALUES (?, ?, ?, ?, NULL, NULL)',
      ).bind(shareId, billId, member.id, amountCents),
    )
  }

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: title.trim(),
      totalCents,
      shares,
    },
    201,
  )
})

// List bills with shares for a home
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  interface BillRow {
    id: string
    home_id: string
    title: string
    total_cents: number
    created_at: number
  }

  interface ShareRow {
    id: string
    bill_id: string
    member_id: string
    amount_cents: number
    paid_at: string | null
  }

  const billsResult = await c.env.DB.prepare(
    'SELECT id, home_id, title, total_cents, created_at FROM bills WHERE home_id = ? ORDER BY rowid DESC',
  )
    .bind(homeId)
    .all<BillRow>()

  const bills = billsResult.results ?? []
  if (bills.length === 0) {
    return c.json({ bills: [] }, 200)
  }

  const sharesResult = await c.env.DB.prepare(`
    SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at
    FROM shares s
    JOIN bills b ON b.id = s.bill_id
    WHERE b.home_id = ?
    ORDER BY s.rowid ASC
  `)
    .bind(homeId)
    .all<ShareRow>()

  const sharesByBillId = new Map<
    string,
    Array<{ id: string; memberId: string; amountCents: number; paidAt: string | null }>
  >()
  for (const s of sharesResult.results ?? []) {
    const list = sharesByBillId.get(s.bill_id) ?? []
    list.push({
      id: s.id,
      memberId: s.member_id,
      amountCents: s.amount_cents,
      paidAt: s.paid_at,
    })
    sharesByBillId.set(s.bill_id, list)
  }

  const responseBills = bills.map((b) => ({
    id: b.id,
    homeId: b.home_id,
    title: b.title,
    totalCents: b.total_cents,
    shares: sharesByBillId.get(b.id) ?? [],
  }))

  return c.json({ bills: responseBills }, 200)
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const idempotencyKey = c.req.header('Idempotency-Key') ?? c.req.header('idempotency-key')

  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const trimmedKey = idempotencyKey.trim()

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()
  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  interface ShareRow {
    id: string
    bill_id: string
    member_id: string
    amount_cents: number
    paid_at: string | null
    idempotency_key: string | null
  }

  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paid_at !== null) {
    if (share.idempotency_key === trimmedKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  const paidAt = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, trimmedKey, shareId, billId)
    .run()

  if (updateResult.meta.changes === 0) {
    const currentShare = await c.env.DB.prepare(
      'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
    )
      .bind(shareId, billId)
      .first<ShareRow>()

    if (currentShare && currentShare.idempotency_key === trimmedKey) {
      return c.json(
        {
          id: currentShare.id,
          memberId: currentShare.member_id,
          amountCents: currentShare.amount_cents,
          paidAt: currentShare.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different key' }, 409)
  }

  return c.json(
    {
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt,
    },
    200,
  )
})

// Get balances of a home
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  interface BalanceRow {
    memberId: string
    name: string
    outstandingCents: number
  }

  const balancesResult = await c.env.DB.prepare(`
    SELECT 
      m.id AS memberId,
      m.name AS name,
      COALESCE(
        (
          SELECT SUM(s.amount_cents)
          FROM shares s
          JOIN bills b ON b.id = s.bill_id
          WHERE s.member_id = m.id
            AND b.home_id = m.home_id
            AND s.paid_at IS NULL
        ),
        0
      ) AS outstandingCents
    FROM members m
    WHERE m.home_id = ?
    ORDER BY m.rowid ASC
  `)
    .bind(homeId)
    .all<BalanceRow>()

  return c.json(
    {
      balances: balancesResult.results ?? [],
    },
    200,
  )
})

export default app
