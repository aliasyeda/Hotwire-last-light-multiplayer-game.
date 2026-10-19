import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'

const url = process.env.GAME_URL || 'http://127.0.0.1:3011'
const clients = []
const states = new Map()
const joined = new Map()
const errors = new Map()
const routed = new Set()
const seenEvents = new Set()
let sawWarning = false
let server

function createClient(mode = 'correct') {
  const socket = io(url, { transports: ['websocket', 'polling'], reconnection: false, timeout: 3000 })
  clients.push(socket); errors.set(socket, [])
  socket.on('room:state', state => {
    states.set(socket, state)
    if (state.event?.kind) seenEvents.add(state.event.kind)
    if (state.nextEvent?.warning) sawWarning = true
    // Test operator actively routes every incoming pulse to the live requested district.
    const me = state.players.find(player => player.id === joined.get(socket)?.playerId)
    for (const pulse of state.pulses || []) {
      if (me?.relays.includes(pulse.relay) && state.routes[pulse.relay] !== pulse.target) {
        const key = `${socket.id}:${pulse.id}`
        if (!routed.has(key)) { routed.add(key); const destination = mode === 'wrong' ? (pulse.target === 'hospital' ? 'water' : 'hospital') : pulse.target; socket.emit('game:action', { type: 'route', relay: pulse.relay, destination }) }
      }
    }
  })
  socket.on('room:joined', value => joined.set(socket, value))
  socket.on('game:error', value => errors.get(socket).push(value.message))
  return socket
}
function waitFor(predicate, label, timeout = 6000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try { const value = await predicate(); if (value) { clearInterval(timer); resolve(value) } else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error(`Timed out waiting for ${label}`)) } }
      catch (error) { clearInterval(timer); reject(error) }
    }, 15)
  })
}
function connected(socket) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 4000); socket.once('connect', () => { clearTimeout(timer); resolve() }) }) }
function ack(socket, event, payload) { return new Promise((resolve, reject) => socket.emit(event, payload, result => result?.ok ? resolve(result) : reject(new Error(result?.error || `${event} failed`)))) }
function action(socket, type, data = {}) { return ack(socket, 'game:action', { type, ...data }) }

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, PORT: '3011', GAME_DURATION_MS: '12000', READY_COUNTDOWN_MS: '150' } })
  await waitFor(asyncHealth, 'test server health', 10000)
}
async function asyncHealth() { try { const r = await fetch(`${url}/health`); return r.ok } catch { return false } }

try {
  await startServer()
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true, game: 'hotwire-last-light', rooms: 0 })
  assert.ok((await (await fetch(url)).text()).includes('Hotwire: Last Light'), 'server serves the Hotwire production client')

  const a = createClient(), b = createClient(); await Promise.all([connected(a), connected(b)])
  const created = await ack(a, 'room:create', { nickname: 'Mara' }); await waitFor(() => joined.get(a), 'host seat')
  await ack(b, 'room:join', { nickname: 'Ivo', code: created.code }); await waitFor(() => joined.get(b), 'second seat')
  let lobby = states.get(a)
  assert.equal(lobby.players.length, 2); assert.equal(lobby.players.reduce((sum, p) => sum + p.relays.length, 0), 8, 'two-person team gets all eight relays')
  assert.deepEqual(lobby.players.map(p => p.relays.length).sort(), [4, 4], 'both players receive four controls')

  const unauthorized = await action(b, 'route', { relay: lobby.players.find(p => p.id === joined.get(a).playerId).relays[0], destination: 'hospital' }).then(() => false, () => true)
  assert.equal(unauthorized, true, 'server rejects another player operating a relay')
  await action(a, 'start'); await waitFor(() => states.get(a)?.phase === 'playing', 'live match', 3000)
  const reconnectSeat = joined.get(b); b.disconnect()
  await waitFor(() => states.get(a)?.players.find(p => p.id === joined.get(a).playerId)?.relays.length === 8, 'offline relay reassignment')
  const b2 = createClient(); await connected(b2); await ack(b2, 'room:reconnect', reconnectSeat)
  await waitFor(() => states.get(b2)?.phase === 'playing', 'reconnected live state')
  await action(b2, 'callout', { callout: 'hospital' })
  assert.equal(states.get(a).calls.at(-1).label, 'HOSPITAL NEEDS POWER', 'one-tap calls synchronize to crew')

  let didVent = false
  const ventTimer = setInterval(() => {
    const state = states.get(a)
    if (!didVent && state?.phase === 'playing' && state.ventCharges > 0) {
      didVent = true; a.emit('game:action', { type: 'vent', district: 'hospital' })
    }
  }, 150)
  const ended = await waitFor(() => states.get(a)?.phase === 'ended' ? states.get(a) : null, 'complete 12-second match', 18000)
  clearInterval(ventTimer)
  assert.ok(ended.result, 'server published a final result')
  assert.ok(ended.result.score >= 0 && ended.result.saves > 0, 'correct live routing scores and saves power')
  assert.ok(ended.result.won, `active two-player team should save the city in the simulation; got ${ended.result.title}`)
  assert.ok(['surge', 'fuse', 'demand'].every(kind => seenEvents.has(kind)), 'all event types visibly resolve during the accelerated match')
  assert.ok(sawWarning, 'the crew gets advance warning before an emergency')
  assert.ok(Object.values(ended.districts).some(value => value > 58), 'successful pulses visibly replenish district power')
  assert.ok(didVent, 'limited vent action was exercised')
  assert.equal(ended.ventCharges, 1, 'vent consumes one shared charge')
  assert.equal(ended.vented.length, 1, 'server records which operator used the vent')
  const previousLayout = ended.layout
  await action(a, 'rematch'); await waitFor(() => states.get(a)?.phase === 'lobby', 'rematch lobby')
  assert.equal(states.get(a).layout, (previousLayout + 1) % 3, 'rematch changes city layout')

  // In a separate room, deliberately misroute every pulse and verify the live overload causes a loss.
  const c = createClient('wrong'), d = createClient('wrong'); await Promise.all([connected(c), connected(d)])
  const lossRoom = await ack(c, 'room:create', { nickname: 'Risk' }); await waitFor(() => joined.get(c), 'loss-test host')
  await ack(d, 'room:join', { nickname: 'Chaos', code: lossRoom.code }); await waitFor(() => joined.get(d), 'loss-test second player')
  await action(c, 'start')
  const loss = await waitFor(() => states.get(c)?.phase === 'ended' ? states.get(c) : null, 'overload loss', 8000)
  assert.equal(loss.result.won, false, 'careless routes can lose the match')
  assert.equal(loss.result.title, 'GRID CASCADE', 'overload reaching its limit has a clear failure result')

  // Check every supported crew size has full relay coverage and gives each player at least one control.
  for (let count = 3; count <= 7; count++) {
    const team = Array.from({ length: count }, () => createClient()); await Promise.all(team.map(connected))
    const room = await ack(team[0], 'room:create', { nickname: `Size ${count} Host` })
    for (let i = 1; i < count; i++) await ack(team[i], 'room:join', { nickname: `Size ${count} Crew ${i}`, code: room.code })
    await waitFor(() => states.get(team[0])?.players.length === count, `${count}-player lobby`)
    const split = states.get(team[0]).players.map(p => p.relays.length)
    assert.equal(split.reduce((a, b) => a + b, 0), 8, `${count}-player assignment covers all relays`)
    assert.ok(split.every(value => value >= 1), `${count}-player assignment gives everyone a relay`)
    team.forEach(player => player.disconnect())
  }

  // Verify the upper player limit, non-empty assignments, and rejection of player nine.
  const group = [a, b2, ...Array.from({ length: 6 }, createClient)]
  for (let i = 2; i < group.length; i++) await connected(group[i])
  for (let i = 2; i < 8; i++) await ack(group[i], 'room:join', { nickname: `Crew ${i + 1}`, code: created.code })
  await waitFor(() => states.get(a)?.players.length === 8, 'eight operators')
  const eight = states.get(a)
  assert.equal(eight.players.reduce((sum, p) => sum + p.relays.length, 0), 8)
  assert.ok(eight.players.every(p => p.relays.length >= 1), 'all eight operators own a relay')
  const ninth = createClient(); await connected(ninth)
  await assert.rejects(ack(ninth, 'room:join', { nickname: 'Ninth', code: created.code }), /full/i)

  console.log(JSON.stringify({ ok: true, room: created.code, playerCounts: '2 through 8 all covered', routeOwnership: 'enforced', reconnect: 'restored live match', quickCall: 'synchronized', vent: didVent, events: [...seenEvents], winMatch: ended.result.title, saves: ended.result.saves, misrouteLoss: loss.result.title, rematchLayout: `${previousLayout} -> ${states.get(a).layout}`, eightPlayerRelayCoverage: eight.players.map(p => p.relays.length), ninthPlayerRejected: true }, null, 2))
} finally {
  for (const socket of clients) socket.disconnect()
  if (server && server.exitCode === null) server.kill()
}
