import { createServer } from 'node:http'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import express from 'express'
import { Server, Socket } from 'socket.io'

type Phase = 'lobby' | 'countdown' | 'playing' | 'ended'
type DistrictId = 'hospital' | 'water' | 'shelter'
type EventKind = 'surge' | 'fuse' | 'demand'
type Player = { id: string; nickname: string; seat: number; online: boolean; socketId?: string; tokenHash: string; ready: boolean }
type Pulse = { id: number; relay: number; target: DistrictId; born: number; arrives: number }
type LiveEvent = { kind: EventKind; target: string; startsAt: number; endsAt: number; label: string }
type Room = {
  code: string; hostId: string; players: Player[]; phase: Phase; createdAt: number; match: number
  deadline?: number; phaseTimer?: NodeJS.Timeout; tick?: NodeJS.Timeout; lastTick: number; elapsed: number
  routes: DistrictId[]; districts: Record<DistrictId, number>; pulses: Pulse[]; nextPulse: number; pulseId: number
  overload: number; score: number; ventCharges: number; vented: string[]; event?: LiveEvent
  eventPlan: { at: number; kind: EventKind; target: string; duration: number; label: string }[]; firedEvents: number[]
  calls: { id: string; player: string; icon: string; label: string; at: number }[]; result?: { won: boolean; title: string; summary: string; score: number; elapsed: number; saves: number; wasted: number; bestDistrict: DistrictId }
  saves: number; wasted: number; targetCursor: number; layout: number
}

const app = express()
const httpServer = createServer(app)
app.use(express.static('dist'))
const allowedOrigin = process.env.CLIENT_ORIGIN || true
const io = new Server(httpServer, { cors: { origin: allowedOrigin, methods: ['GET', 'POST'] } })
const rooms = new Map<string, Room>()
const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const districts: DistrictId[] = ['hospital', 'water', 'shelter']
const GAME_DURATION_MS = Math.max(10000, Number(process.env.GAME_DURATION_MS || 90000))
const GAME_SCALE = GAME_DURATION_MS / 90000
const READY_COUNTDOWN_MS = Math.max(100, Number(process.env.READY_COUNTDOWN_MS || 3000))
const roomCode = () => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const roomOrFail = (code: string) => { const room = rooms.get(String(code || '').toUpperCase()); if (!room) throw new Error('Room code not found.'); return room }
const playerOrFail = (room: Room, socket: Socket) => { const p = room.players.find(x => x.id === socket.data.playerId); if (!p || p.socketId !== socket.id) throw new Error('Reconnect to your saved seat to play.'); return p }
const ownerFor = (room: Room, relay: number) => {
  const active = room.players.filter(player => player.online)
  const operators = active.length ? active : room.players
  return operators[Math.floor(relay * operators.length / 8)]
}
function makePlan(code: string, match: number) {
  const seed = [...`${code}:${match}`].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0
  let x = seed || 1
  const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0 }
  const kinds: EventKind[] = ['surge', 'fuse', 'demand', 'surge', 'fuse', 'demand']
  return kinds.map((kind, i) => {
    const target = kind === 'fuse' ? String(next() % 8) : districts[next() % 3]
    return { at: [16, 31, 46, 61, 73, 82][i] * GAME_SCALE, kind, target, duration: (kind === 'fuse' ? 7 : 10) * GAME_SCALE, label: kind === 'surge' ? `SURGE → ${String(target).toUpperCase()}` : kind === 'demand' ? `DEMAND SPIKE → ${String(target).toUpperCase()}` : `FUSE FAILURE → RELAY ${Number(target) + 1}` }
  })
}
function makeRoom(code: string, hostId: string, player: Player): Room {
  return { code, hostId, players: [player], phase: 'lobby', createdAt: Date.now(), match: 0, lastTick: 0, elapsed: 0,
    routes: Array.from({ length: 8 }, (_, i) => districts[(i + Math.floor(Math.random() * 3)) % 3]),
    districts: { hospital: 60, water: 60, shelter: 60 }, pulses: [], nextPulse: 0, pulseId: 0, overload: 0,
    score: 0, ventCharges: 2, vented: [], eventPlan: [], firedEvents: [], calls: [], saves: 0, wasted: 0, targetCursor: 0, layout: randomInt(3) }
}
function publicState(room: Room) {
  const now = Date.now()
  const eventIndex = room.eventPlan.findIndex((_, i) => !room.firedEvents.includes(i))
  const event = eventIndex >= 0 ? room.eventPlan[eventIndex] : undefined
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, match: room.match, players: room.players.map(p => ({ id: p.id, nickname: p.nickname, online: p.online, ready: p.ready, relays: Array.from({ length: 8 }, (_, relay) => relay).filter(relay => ownerFor(room, relay)?.id === p.id) })),
    minPlayers: 2, maxPlayers: 8, elapsed: room.elapsed, secondsLeft: room.phase === 'countdown' ? Math.max(0, Math.ceil(((room.deadline || now) - now) / 1000)) : Math.max(0, Math.ceil((GAME_DURATION_MS / 1000) - room.elapsed)),
    routes: room.routes, districts: room.districts, pulses: room.pulses.map(p => ({ ...p, route: room.routes[p.relay], progress: clamp((now - p.born) / (p.arrives - p.born), 0, 1) })),
    overload: room.overload, score: room.score, ventCharges: room.ventCharges, vented: room.vented, event: room.event,
    nextEvent: event ? { ...event, warning: event.at - room.elapsed <= 5 } : undefined,
    calls: room.calls.slice(-8), layout: room.layout, result: room.result,
    canStart: room.players.length >= 2 && room.players.length <= 8,
  }
}
function push(room: Room) { io.to(room.code).emit('room:state', publicState(room)) }
function fail(socket: Socket, ack: ((v: unknown) => void) | undefined, message: string) { ack?.({ ok: false, error: message }); socket.emit('game:error', { message }) }
function clear(room: Room) { if (room.tick) clearInterval(room.tick); if (room.phaseTimer) clearTimeout(room.phaseTimer); room.tick = undefined; room.phaseTimer = undefined }
function end(room: Room, won: boolean, title: string, summary: string) {
  if (room.phase === 'ended') return
  clear(room); room.phase = 'ended'
  const bestDistrict = districts.sort((a, b) => room.districts[b] - room.districts[a])[0]
  room.result = { won, title, summary, score: room.score, elapsed: room.elapsed, saves: room.saves, wasted: room.wasted, bestDistrict }
  push(room)
}
type TimedRoom = Room & { gameEndsAt?: number }
function tickRoom(room: TimedRoom) {
  if (room.phase !== 'playing') return
  const now = Date.now(); const dt = Math.min(0.5, (now - room.lastTick) / 1000); room.lastTick = now
  // The game clock is based on a server deadline, never a client clock.
  room.elapsed = Math.min(GAME_DURATION_MS / 1000, Math.max(0, GAME_DURATION_MS / 1000 - Math.max(0, (room.gameEndsAt || now) - now) / 1000))
  for (const [index, event] of room.eventPlan.entries()) {
    if (!room.firedEvents.includes(index) && room.elapsed >= event.at) {
      room.firedEvents.push(index); room.event = { kind: event.kind, target: event.target, startsAt: now, endsAt: now + event.duration * 1000, label: event.label }
      if (event.kind === 'fuse') { room.overload = clamp(room.overload + 9, 0, 100); room.score = Math.max(0, room.score - 25) }
      if (event.kind === 'surge') room.overload = clamp(room.overload + 4, 0, 100)
    }
  }
  if (room.event && now >= room.event.endsAt) room.event = undefined
  // The districts slowly drain; a demand spike drains its district much faster.
  for (const d of districts) room.districts[d] = clamp(room.districts[d] - dt * (0.20 + (room.event?.kind === 'demand' && room.event.target === d ? 0.52 : 0)), 0, 100)
  if (room.elapsed >= room.nextPulse && room.elapsed < GAME_DURATION_MS / 1000) {
    const relay = (room.pulseId * 3 + room.layout) % 8
    const ranked = [...districts].sort((a, b) => room.districts[a] - room.districts[b])
    const lowest = ranked.filter(d => room.districts[d] === room.districts[ranked[0]])
    const target = lowest[room.targetCursor++ % lowest.length]
    room.pulses.push({ id: ++room.pulseId, relay, target, born: now, arrives: now + 2800 * GAME_SCALE })
    room.nextPulse += 1.8 * GAME_SCALE
  }
  const arrived = room.pulses.filter(p => now >= p.arrives)
  room.pulses = room.pulses.filter(p => now < p.arrives)
  for (const pulse of arrived) {
    const routed = room.routes[pulse.relay]
    if (room.event?.kind === 'fuse' && Number(room.event.target) === pulse.relay) { room.overload = clamp(room.overload + 15, 0, 100); room.wasted += 1; continue }
    const eventBonus = room.event?.kind === 'surge' && room.event.target === routed
    if (routed === pulse.target) {
      room.districts[routed] = clamp(room.districts[routed] + 22, 0, 100); room.overload = clamp(room.overload - 3, 0, 100); room.score += 100 + (eventBonus ? 50 : 0); room.saves += 1
    } else {
      room.districts[routed] = clamp(room.districts[routed] + 7, 0, 100); room.overload = clamp(room.overload + (room.event?.kind === 'surge' ? 13 : 9), 0, 100); room.score = Math.max(0, room.score - 15); room.wasted += 1
    }
  }
  if (room.overload >= 100) return end(room, false, 'GRID CASCADE', 'The overload reached its limit. The city grid collapsed.')
  if (districts.filter(d => room.districts[d] > 0).length < 2) return end(room, false, 'CITYWIDE BLACKOUT', 'Two districts went dark. The crew could not restore enough power.')
  if (room.elapsed >= GAME_DURATION_MS / 1000) {
    const powered = districts.filter(d => room.districts[d] > 0).length
    return end(room, powered >= 2 && room.overload < 100, powered >= 2 ? 'THE CITY HOLDS' : 'CITYWIDE BLACKOUT', powered >= 2 ? 'The crew kept at least two districts online through the final surge.' : 'The grid ran out of time before the districts could be saved.')
  }
  push(room)
}

io.on('connection', socket => {
  socket.on('room:create', (payload: { nickname?: string }, ack?: (v: any) => void) => {
    try {
      const nickname = String(payload?.nickname || '').trim().slice(0, 20); if (!nickname) throw new Error('Enter your callsign.')
      let code = roomCode(); while (rooms.has(code)) code = roomCode()
      const token = randomBytes(32).toString('hex'), id = randomUUID()
      const room = makeRoom(code, id, { id, nickname, seat: 0, online: true, socketId: socket.id, tokenHash: hash(token), ready: true }) as TimedRoom
      rooms.set(code, room); socket.data.roomCode = code; socket.data.playerId = id; socket.join(code)
      socket.emit('room:joined', { code, playerId: id, token, isHost: true }); push(room); ack?.({ ok: true, code })
    } catch (error) { fail(socket, ack, (error as Error).message) }
  })
  socket.on('room:join', (payload: { code?: string; nickname?: string }, ack?: (v: any) => void) => {
    try {
      const room = roomOrFail(payload?.code || ''); const nickname = String(payload?.nickname || '').trim().slice(0, 20)
      if (!nickname) throw new Error('Enter your callsign.')
      if (room.phase !== 'lobby') throw new Error('This match has started. Use your saved seat to reconnect.')
      if (room.players.length >= 8) throw new Error('Room is full (8 players max).')
      if (room.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase())) throw new Error('That callsign is already in this room.')
      const id = randomUUID(), token = randomBytes(32).toString('hex')
      room.players.push({ id, nickname, seat: room.players.length, online: true, socketId: socket.id, tokenHash: hash(token), ready: true })
      socket.data.roomCode = room.code; socket.data.playerId = id; socket.join(room.code)
      socket.emit('room:joined', { code: room.code, playerId: id, token, isHost: false }); push(room); ack?.({ ok: true, code: room.code })
    } catch (error) { fail(socket, ack, (error as Error).message) }
  })
  socket.on('room:reconnect', (payload: { code?: string; playerId?: string; token?: string }, ack?: (v: any) => void) => {
    try {
      const room = roomOrFail(payload?.code || ''), player = room.players.find(p => p.id === payload?.playerId)
      if (!player || !payload?.token || hash(payload.token) !== player.tokenHash) throw new Error('Saved seat could not be verified.')
      if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.disconnect(true)
      player.socketId = socket.id; player.online = true; socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.join(room.code)
      socket.emit('room:joined', { code: room.code, playerId: player.id, token: payload.token, isHost: room.hostId === player.id }); push(room); ack?.({ ok: true })
    } catch (error) { fail(socket, ack, (error as Error).message) }
  })
  socket.on('game:action', (action: Record<string, unknown>, ack?: (v: any) => void) => {
    try {
      const room = roomOrFail(String(socket.data.roomCode || '')) as TimedRoom, player = playerOrFail(room, socket), type = String(action?.type || '')
      if (type === 'start') {
        if (room.hostId !== player.id) throw new Error('Only the host can start the match.')
        if (room.phase !== 'lobby' || room.players.length < 2) throw new Error('Need 2–8 players in the lobby to start.')
        room.match += 1; room.phase = 'countdown'; room.deadline = Date.now() + READY_COUNTDOWN_MS; room.result = undefined
        room.routes = Array.from({ length: 8 }, (_, i) => districts[(i + room.layout + room.match) % 3]); room.districts = { hospital: 58, water: 58, shelter: 58 }
        room.pulses = []; room.pulseId = 0; room.nextPulse = 1; room.overload = 14; room.score = 0; room.ventCharges = 2; room.vented = []; room.event = undefined; room.eventPlan = makePlan(room.code, room.match); room.firedEvents = []; room.calls = []; room.saves = 0; room.wasted = 0; room.targetCursor = room.match % 3; room.elapsed = 0
        room.phaseTimer = setTimeout(() => {
          if (room.phase !== 'countdown') return
          room.phase = 'playing'; room.gameEndsAt = Date.now() + GAME_DURATION_MS; room.lastTick = Date.now(); room.nextPulse = GAME_SCALE
          room.tick = setInterval(() => tickRoom(room), 250); push(room)
        }, READY_COUNTDOWN_MS)
      } else if (type === 'route') {
        if (room.phase !== 'playing') throw new Error('Relays can only be changed during a live match.')
        const relay = Number(action.relay), destination = String(action.destination) as DistrictId
        if (!Number.isInteger(relay) || relay < 0 || relay > 7 || !districts.includes(destination)) throw new Error('Invalid relay route.')
        if (ownerFor(room, relay)?.id !== player.id) throw new Error('That relay belongs to another player.')
        room.routes[relay] = destination; push(room)
      } else if (type === 'vent') {
        if (room.phase !== 'playing') throw new Error('Vent is available during the live match.')
        if (room.ventCharges < 1) throw new Error('No vent charges remain.')
        const district = String(action.district) as DistrictId
        if (!districts.includes(district)) throw new Error('Choose a district to stabilize.')
        room.ventCharges -= 1; room.vented.push(player.nickname); room.overload = clamp(room.overload - 22, 0, 100); room.districts[district] = clamp(room.districts[district] + 12, 0, 100); room.score += 40; room.calls.push({ id: randomUUID(), player: player.nickname, icon: 'VENT', label: `VENTED · ${district.toUpperCase()} STABILIZED`, at: Date.now() }); push(room)
      } else if (type === 'callout') {
        const calls: Record<string, string> = { hospital: 'HOSPITAL NEEDS POWER', water: 'WATER PLANT NEEDS POWER', shelter: 'SHELTER NEEDS POWER', surge: 'SURGE INCOMING', vent: 'VENT THE GRID', ready: 'ROUTE LOCKED' }
        const key = String(action.callout); if (!calls[key]) throw new Error('Unknown callout.')
        room.calls.push({ id: randomUUID(), player: player.nickname, icon: key.toUpperCase(), label: calls[key], at: Date.now() }); room.calls = room.calls.slice(-8); push(room)
      } else if (type === 'rematch') {
        if (room.phase !== 'ended') throw new Error('The match is still in progress.')
        if (room.players.length < 2) throw new Error('Need at least 2 players for a rematch.')
        room.players = room.players.filter(p => p.online); room.players.forEach((p, i) => { p.seat = i; p.ready = true })
        room.layout = (room.layout + 1) % 3; room.phase = 'lobby'; room.result = undefined; room.hostId = room.players[0]?.id || player.id
        push(room)
      } else throw new Error('Unknown game action.')
      ack?.({ ok: true })
    } catch (error) { fail(socket, ack, (error as Error).message) }
  })
  socket.on('disconnect', () => {
    const room = rooms.get(String(socket.data.roomCode || '')); if (!room) return
    const player = room.players.find(p => p.id === socket.data.playerId && p.socketId === socket.id)
    if (player) { player.online = false; player.socketId = undefined; if (room.phase === 'lobby' && room.hostId === player.id) room.hostId = room.players.find(p => p.online)?.id || room.hostId; push(room) }
  })
})

app.get('/health', (_req, res) => res.json({ ok: true, game: 'hotwire-last-light', rooms: rooms.size }))
app.use((_req, res) => res.sendFile('index.html', { root: 'dist' }))
const port = Number(process.env.PORT || 3001)
httpServer.listen(port, '0.0.0.0', () => console.log(`Hotwire server listening on ${port}`))
