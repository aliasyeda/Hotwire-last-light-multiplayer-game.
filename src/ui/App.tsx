import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Activity, ArrowRight, Check, Copy, Droplets, Flame, Gauge, HeartPulse, Link2, Map, Radio, RotateCcw, ShieldAlert, Siren, Volume2, VolumeX, Zap } from 'lucide-react'

type District = 'hospital' | 'water' | 'shelter'
type Player = { id: string; nickname: string; online: boolean; ready: boolean; relays: number[] }
type State = { code: string; phase: 'lobby' | 'countdown' | 'playing' | 'ended'; hostId: string; match: number; players: Player[]; secondsLeft: number; elapsed: number; routes: District[]; districts: Record<District, number>; pulses: { id: number; relay: number; target: District; route: District; progress: number }[]; overload: number; score: number; saves: number; wasted: number; ventCharges: number; vented: string[]; event?: { kind: string; target: string; endsAt: number; label: string }; nextEvent?: { kind: string; target: string; at: number; label: string; warning: boolean }; calls: { id: string; player: string; icon: string; label: string }[]; layout: number; canStart: boolean; result?: { won: boolean; title: string; summary: string; score: number; elapsed: number; saves: number; wasted: number; bestDistrict: District } }
type Seat = { code: string; playerId: string; token: string }
const STORE = 'hotwire-seat-v1'
const names: Record<District, string> = { hospital: 'Hospital', water: 'Water Plant', shelter: 'Shelter' }
const colors: Record<District, string> = { hospital: '#ff617a', water: '#57d9ed', shelter: '#b389ff' }
const icons = { hospital: HeartPulse, water: Droplets, shelter: ShieldAlert }
const socket: Socket = io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, timeout: 8000 })
const emptyState: State | null = null

export default function App() {
  const [connected, setConnected] = useState(socket.connected)
  const [connectionFailed, setConnectionFailed] = useState(false)
  const [room, setRoom] = useState<State | null>(emptyState)
  const [seat, setSeat] = useState<Seat | null>(() => { try { return JSON.parse(localStorage.getItem(STORE) || 'null') } catch { return null } })
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem('hotwire-muted') === 'true')
  const [copyDone, setCopyDone] = useState(false)
  const seenEvent = useRef('')
  const previousPhase = useRef('')
  const lastSecond = useRef(-1)
  const seatRef = useRef(seat)
  const mutedRef = useRef(muted)
  seatRef.current = seat
  mutedRef.current = muted

  const action = useCallback((type: string, extra: Record<string, unknown> = {}) => new Promise<{ ok: boolean; error?: string }>(resolve => {
    socket.emit('game:action', { type, ...extra }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok) setError(result?.error || 'That action did not go through.')
      resolve(result || { ok: false })
    })
  }), [])

  useEffect(() => {
    const onConnect = () => { setConnected(true); setConnectionFailed(false); setError(current => current.startsWith('Game server is not reachable') ? '' : current); const saved: Seat | null = seatRef.current || JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) socket.emit('room:reconnect', saved, (r: { ok: boolean; error?: string }) => { if (!r?.ok) { localStorage.removeItem(STORE); seatRef.current = null; setSeat(null); setError('Could not reconnect to that room. Create or join a room again.') } }) }
    const onDisconnect = () => setConnected(false)
    const onConnectError = () => { setConnected(false); setConnectionFailed(true); setError('Game server is not reachable yet. Check the server is running, then retry.') }
    const onJoined = (value: { code: string; playerId: string; token: string }) => { const s = { code: value.code, playerId: value.playerId, token: value.token }; localStorage.setItem(STORE, JSON.stringify(s)); seatRef.current = s; setSeat(s); setCode(value.code) }
    const onState = (value: State) => { setRoom(value); if (previousPhase.current === 'playing' && value.phase === 'ended' && !mutedRef.current) sound(value.result?.won ? 'win' : 'danger'); previousPhase.current = value.phase; if (value.event?.label && seenEvent.current !== value.event.label) { seenEvent.current = value.event.label; if (!mutedRef.current) sound(value.event.kind === 'fuse' ? 'danger' : 'ping') } }
    const onError = (value: { message: string }) => setError(value.message)
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('connect_error', onConnectError); socket.on('room:joined', onJoined); socket.on('room:state', onState); socket.on('game:error', onError)
    if (socket.connected && seat) onConnect()
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError); socket.off('room:joined', onJoined); socket.off('room:state', onState); socket.off('game:error', onError) }
  }, [])

  useEffect(() => { if (room?.phase !== 'playing') return; const sec = room.secondsLeft; if (sec <= 10 && sec > 0 && sec !== lastSecond.current && sec <= 5 && !muted) sound('tick'); lastSecond.current = sec }, [room?.secondsLeft, room?.phase, muted])
  const me = useMemo(() => room?.players.find(p => p.id === seat?.playerId), [room, seat])
  const time = room?.secondsLeft || 0
  const myRelays = me?.relays || []
  const send = (type: string, extra: Record<string, unknown> = {}) => { setError(''); void action(type, extra) }
  const join = (mode: 'create' | 'join') => {
    if (!connected) { setError('Connecting to game server…'); return }
    if (!nickname.trim()) { setError('Enter your callsign first.'); return }
    setBusy(true); setError('')
    socket.emit(mode === 'create' ? 'room:create' : 'room:join', mode === 'create' ? { nickname } : { nickname, code }, (r: { ok: boolean; error?: string }) => { setBusy(false); if (!r?.ok) setError(r?.error || 'Could not enter room.') })
  }
  const copy = async () => { if (!room) return; try { await navigator.clipboard.writeText(room.code); setCopyDone(true); setTimeout(() => setCopyDone(false), 1600) } catch { setError(`Room code: ${room.code}`) } }
  const setRoute = (relay: number, destination: District) => { send('route', { relay, destination }); if (!muted) sound('switch') }

  if (!room) return <main className="landing"><header className="brand"><span className="brand-icon"><Zap /></span><div>HOTWIRE <small>LAST LIGHT</small></div><span className={`server-pill ${connected ? 'online' : ''}`}><i />{connected ? 'GRID ONLINE' : connectionFailed ? 'SERVER OFFLINE' : 'CONNECTING'}</span></header><section className="hero"><div className="city-lines" /><span className="eyebrow"><i /> LIVE CO-OP GRID SURVIVAL</span><h1>KEEP THE<br /><em>LIGHTS ON.</em></h1><p>Route power. Fight the cascade.<br />Save the city together.</p><div className="quick-stats"><span><b>02—08</b> PLAYERS</span><span><b>90</b> SECONDS</span><span><b>ONE</b> SHARED GRID</span></div></section><section className="join-card"><div className="card-top"><div><span className="eyebrow">CREW ACCESS</span><h2>Enter the grid</h2></div><Radio size={20} /></div><label>YOUR CALLSIGN<input maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Morrow" autoComplete="nickname" /></label><button className="primary wide" disabled={busy || !connected} onClick={() => join('create')}>{busy ? 'CONNECTING…' : 'CREATE A ROOM'}<ArrowRight size={17} /></button><div className="separator"><span />OR JOIN YOUR CREW<span /></div><div className="join-row"><input aria-label="Room code" value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0, 5))} placeholder="ROOM CODE" maxLength={5} /><button className="secondary" disabled={busy || !connected || code.length < 5} onClick={() => join('join')}>JOIN</button></div>{error && <p className="error-line">{error}</p>}{seat && <button className="reconnect-link" onClick={() => { setError('Reconnecting to saved seat…'); if (socket.connected) socket.emit('room:reconnect', seat, (r: any) => { if (!r?.ok) setError(r.error || 'Reconnect failed.') }) }}>↗ Reconnect to room {seat.code}</button>}</section><footer className="landing-foot">NO DOWNLOADS <i /> NO ACCOUNTS <i /> JUST YOUR CREW</footer></main>

  const isHost = room.hostId === seat?.playerId
  const warning = room.nextEvent?.warning
  const activeTarget = room.event?.kind === 'surge' ? room.event.target : room.event?.kind === 'demand' ? room.event.target : ''
  const layoutName = ['NORTH SPINE', 'SPLIT FEED', 'RING CIRCUIT'][room.layout] || 'NORTH SPINE'
  const layoutPoints: [number, number][][] = [
    [[255,92],[431,92],[607,92],[783,92],[255,338],[431,338],[607,338],[783,338]],
    [[270,78],[455,78],[640,78],[820,145],[820,285],[640,352],[455,352],[270,352]],
    [[245,130],[420,78],[600,130],[780,78],[245,300],[420,360],[600,300],[780,360]],
  ]
  const relayPoints = layoutPoints[room.layout] || layoutPoints[0]

  return <main className={`game ${room.phase === 'playing' ? 'is-live' : ''}`}>
    <header className="topbar"><div className="brand small-brand"><span className="brand-icon"><Zap /></span><div>HOTWIRE <small>LAST LIGHT</small></div></div><div className="top-right"><div className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'LIVE LINK' : connectionFailed ? 'SERVER OFFLINE' : 'RECONNECTING'}</div>{room.phase !== 'lobby' && <button className="icon-btn" aria-label={muted ? 'Unmute sound' : 'Mute sound'} onClick={() => { const v = !muted; mutedRef.current = v; setMuted(v); localStorage.setItem('hotwire-muted', String(v)) }}>{muted ? <VolumeX /> : <Volume2 />}</button>}<button className="code-pill" onClick={() => void copy()}><Link2 size={14} /><span>{copyDone ? 'COPIED' : room.code}</span><Copy size={13} /></button></div></header>

    {room.phase === 'lobby' && <section className="lobby-screen"><div className="lobby-intro"><span className="eyebrow">ROOM {room.code} · MATCH {room.match + 1}</span><h1>YOUR CREW.<br /><em>ONE GRID.</em></h1><p>Send the room code to your crew. Once two operators are in, you're cleared to launch.</p></div><div className="lobby-board"><div className="lobby-heading"><div><span className="eyebrow">CONNECTED OPERATORS</span><h2>{room.players.length}<small> / 8</small></h2></div><button className="secondary" onClick={() => void copy()}>{copyDone ? <Check size={15} /> : <Copy size={15} />}{copyDone ? 'COPIED' : 'COPY INVITE'}</button></div><div className="player-list">{room.players.map((p, i) => <article key={p.id} className="player-row"><span className={`player-avatar avatar-${i % 4}`}>{p.nickname.slice(0, 1).toUpperCase()}</span><div><b>{p.nickname}{p.id === room.hostId && <small className="host-label">HOST</small>}</b><small>OPERATIVE {String(i + 1).padStart(2, '0')} · {p.relays.length} RELAY{p.relays.length === 1 ? '' : 'S'}</small></div><i className={`online-dot ${p.online ? 'on' : ''}`} /></article>)}{room.players.length < 2 && <div className="waiting"><Radio size={17} /> Waiting for one more operator…</div>}</div><div className="lobby-bottom"><span><Zap size={16} /> 90 seconds. Keep 2 districts alive.</span>{isHost && <button className="primary" disabled={!room.canStart} onClick={() => send('start')}>START MATCH <ArrowRight size={16} /></button>}</div></div><div className="how-strip"><span><b>01</b> Set your relays</span><span><b>02</b> Match the pulse to the district that needs it</span><span><b>03</b> Save the grid</span></div></section>}

    {room.phase === 'countdown' && <section className="countdown-screen"><div className="count-ring"><strong>{time}</strong></div><span className="eyebrow">GRID SYNCHRONIZING</span><h1>STANDBY, {me?.nickname.toUpperCase()}.</h1><p>Find your relay markers. The first pulse is inbound.</p><div className="count-ready">{room.players.map(p => <span key={p.id}><i className={p.online ? 'on' : ''} />{p.nickname}</span>)}</div></section>}

    {room.phase === 'playing' && <><section className="hud"><div className="clock-block"><span className="eyebrow">TIME TO BLACKOUT</span><strong className={time <= 15 ? 'urgent' : ''}>{`00:${String(time).padStart(2, '0')}`}</strong><div className="time-track"><i style={{ width: `${(time / 90) * 100}%` }} /></div></div><div className="score-block"><span className="eyebrow">CREW SCORE</span><strong>{room.score.toLocaleString()}</strong><small>{room.saves} clean routes <i /> {room.wasted} misroutes</small></div><div className="overload-block"><div className="meter-label"><span className="eyebrow"><Gauge size={13} /> GRID OVERLOAD</span><b className={room.overload > 65 ? 'urgent' : ''}>{room.overload}%</b></div><div className="overload-track"><i style={{ width: `${room.overload}%` }} /></div><small>{room.overload >= 75 ? 'CRITICAL · VENT NOW' : room.overload >= 45 ? 'UNSTABLE' : 'WITHIN LIMITS'}</small></div></section>

      {(room.event || warning) && <div className={`event-banner ${room.event ? 'event-live' : ''} ${room.event?.kind || room.nextEvent?.kind}`}><Siren size={17} /><div><b>{room.event ? room.event.label : `INCOMING · ${room.nextEvent?.label}`}</b><small>{room.event ? 'ACTIVE — react now' : `IMPACT IN ${Math.max(0, (room.nextEvent?.at || 0) - room.elapsed)}s · prepare your route`}</small></div><span className="event-light" /></div>}

      <section className="district-row">{(['hospital', 'water', 'shelter'] as District[]).map(id => { const Icon = icons[id]; const value = Math.round(room.districts[id]); return <article key={id} className={`district-card ${value < 25 ? 'critical' : ''} ${activeTarget === id ? 'surged' : ''}`} style={{ '--district': colors[id] } as React.CSSProperties}><div className="district-top"><span className="district-icon"><Icon /></span><span className="eyebrow">{names[id]}</span>{room.nextEvent?.target === id && room.nextEvent.kind === 'demand' && <span className="spike-tag">SPIKE</span>}</div><div className="district-value"><strong>{value}</strong><span>%</span><small>{value > 70 ? 'STABLE' : value > 35 ? 'LOW' : value > 0 ? 'CRITICAL' : 'OFFLINE'}</small></div><div className="battery-track"><i style={{ width: `${value}%` }} /></div></article> })}</section>

      <section className="grid-panel"><div className="grid-head"><div><span className="eyebrow"><Activity size={13} /> LIVE POWER NETWORK · {layoutName}</span><h2>ROUTE THE PULSE</h2></div><div className="pulse-legend"><span><i /> LIVE PULSE</span><span><i /> YOUR RELAY</span></div></div><div className="grid-wrap"><svg className="power-svg" viewBox="0 0 1000 430" role="img" aria-label="Live city power grid with eight relays connected to three districts">
        <defs><linearGradient id="powerLine" x1="0" x2="1"><stop stopColor="#1d3940" /><stop offset="1" stopColor="#34535a" /></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter><pattern id="gridDots" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#b4e6ed" opacity=".12" /></pattern></defs>
        <rect width="1000" height="430" fill="url(#gridDots)" />
        <path className="bus-line" d="M70 214H150V92H800M150 214V338H800" />
        <path className="feeder-line" d="M150 92V338" />
        {[0,1,2,3,4,5,6,7].map(i => { const [x,y] = relayPoints[i]; return <g key={`wire-${i}`}><path className="branch-line" d={`M${x} ${y}L${x} 215H800`} /><path className={`route-line ${room.routes[i]}`} d={`M${x} ${y}L${x} 215H800`} /></g> })}
        <path className="out-line hospital" d="M800 215V54H940" /><path className="out-line water" d="M800 215H940" /><path className="out-line shelter" d="M800 215V376H940" />
        <circle className="source-core" cx="70" cy="214" r="17" /><text x="70" y="258" textAnchor="middle" className="svg-label">GRID CORE</text><path className="source-feed" d="M87 214H150" />
        {[0,1,2,3,4,5,6,7].map(i => { const [x,y] = relayPoints[i]; const mine = myRelays.includes(i); return <g key={`relay-${i}`} className={`relay-node ${mine ? 'mine' : ''} ${room.event?.kind === 'fuse' && Number(room.event.target) === i ? 'fused' : ''}`}><circle cx={x} cy={y} r="22" /><text x={x} y={y + 5} textAnchor="middle" className="relay-number">{String(i + 1).padStart(2, '0')}</text><text x={x} y={y + 42} textAnchor="middle" className="svg-label">{mine ? 'YOUR RELAY' : room.players[Math.floor(i * room.players.length / 8)]?.nickname.toUpperCase().slice(0, 10) || 'OPEN'}</text></g> })}
        {(['hospital','water','shelter'] as District[]).map(id => <g key={id} className={`district-end ${id}`}><circle cx="940" cy={id === 'hospital' ? 54 : id === 'water' ? 215 : 376} r="19" /><text x="940" y={(id === 'hospital' ? 54 : id === 'water' ? 215 : 376) + 4} textAnchor="middle" className="district-letter">{id === 'hospital' ? 'H' : id === 'water' ? 'W' : 'S'}</text></g>)}
        {room.pulses.map(p => { const [x,y] = relayPoints[p.relay]; const progress = p.progress; let px: number, py: number; if (progress < .5) { const t = progress / .5; px = 70 + (x - 70) * t; py = 214 + (y - 214) * t } else if (progress < .74) { const t = (progress - .5) / .24; px = x + (800 - x) * t; py = y + (215 - y) * t } else { const t = (progress - .74) / .26, endY = p.route === 'hospital' ? 54 : p.route === 'water' ? 215 : 376; px = 800 + 140 * t; py = 215 + (endY - 215) * t } return <g key={p.id} className="pulse"><circle cx={px} cy={py} r="10" fill={colors[p.target]} filter="url(#glow)" /><text x={px} y={py + 3} textAnchor="middle" className="pulse-letter">{p.target[0].toUpperCase()}</text></g> })}
        {activeTarget && <text x="830" y="25" textAnchor="middle" className="surge-text">⚡ SURGE</text>}
      </svg></div><div className="relay-heading"><div><span className="eyebrow">YOUR CONTROLS</span><small>Choose H, W, or S directly for each relay.</small></div><span className="layout-tag"><Map size={13} /> {layoutName}</span></div><div className="relay-controls">{myRelays.map(relay => <div key={relay} className="relay-control"><span className="relay-n">R{relay + 1}</span><div className="relay-targets">{(['hospital', 'water', 'shelter'] as District[]).map((destination) => <button key={destination} className={`relay-target ${destination} ${room.routes[relay] === destination ? 'selected' : ''}`} onClick={() => setRoute(relay, destination)} aria-label={`Send relay ${relay + 1} to ${names[destination]}`} title={names[destination]}>{destination === 'hospital' ? 'H' : destination === 'water' ? 'W' : 'S'}</button>)}</div><span className="route-current">{names[room.routes[relay]]}</span></div>)}</div><div className="grid-hint"><span className="pulse-icon"><Zap size={14} /></span><span>For a <b>W</b> pulse, set the relay it passes through to <b>W</b> (Water Plant). H = Hospital; S = Shelter.</span></div></section>

      <section className="action-strip"><div className="callouts"><span className="eyebrow">QUICK CALL</span>{(['hospital', 'water', 'shelter', 'surge'] as const).map(key => <button key={key} onClick={() => send('callout', { callout: key })}>{key === 'surge' ? <Siren /> : (() => { const Icon = icons[key]; return <Icon /> })()}<span>{key === 'surge' ? 'SURGE' : names[key].split(' ')[0].toUpperCase()}</span></button>)}</div><div className="vent-box"><div><span className="eyebrow">EMERGENCY VENT</span><small>{room.ventCharges} CHARGE{room.ventCharges === 1 ? '' : 'S'} · reduces overload by 22</small></div><select id="vent-target" aria-label="District to stabilize"><option value="hospital">Hospital</option><option value="water">Water Plant</option><option value="shelter">Shelter</option></select><button className="vent-button" disabled={room.ventCharges < 1} onClick={() => send('vent', { district: (document.getElementById('vent-target') as HTMLSelectElement)?.value })}><Flame size={16} /> VENT</button></div></section>

      <section className="crew-live"><div className="crew-head"><span className="eyebrow">ON THE GRID</span><span className="operator-count"><i /> {room.players.filter(p => p.online).length} OPERATORS</span></div><div className="crew-chips">{room.players.map(p => <span key={p.id} className={p.id === seat?.playerId ? 'self' : ''}><i className={`online-dot ${p.online ? 'on' : ''}`} />{p.nickname}<small>{p.relays.length}R</small></span>)}</div><div className="call-feed" aria-live="polite">{room.calls.slice(-2).map(c => <span key={c.id}><b>{c.player}</b> {c.label}</span>)}</div></section>
    </>}

    {room.phase === 'ended' && room.result && <section className={`results ${room.result.won ? 'victory' : 'defeat'}`}><div className="result-flash">{room.result.won ? <Zap /> : <Activity />}</div><span className="eyebrow">MATCH {room.match} · {room.result.won ? 'GRID STABILIZED' : 'GRID FAILURE'}</span><h1>{room.result.title}</h1><p>{room.result.summary}</p><div className="result-stats"><div><strong>{room.result.score.toLocaleString()}</strong><small>CREW SCORE</small></div><div><strong>{room.result.saves}</strong><small>CLEAN ROUTES</small></div><div><strong>{room.result.wasted}</strong><small>MISROUTES</small></div><div><strong>{Math.round(room.districts[room.result.bestDistrict])}%</strong><small>STRONGEST · {names[room.result.bestDistrict].toUpperCase()}</small></div></div><div className="ending-city">{(['hospital','water','shelter'] as District[]).map(d => <div key={d} style={{ '--district': colors[d], '--power': `${room.districts[d]}%` } as React.CSSProperties}><i /><span>{names[d]}</span><b>{Math.round(room.districts[d])}%</b></div>)}</div><div className="rematch-row"><button className="primary" onClick={() => send('rematch')}><RotateCcw size={16} /> RUN IT BACK</button><span>New event sequence · new grid layout</span></div></section>}

    {error && <button className="toast" onClick={() => setError('')}>{error}<b>×</b></button>}
    <footer className="game-footer"><span>HOTWIRE: LAST LIGHT <i /> ROOM {room.code}</span><span><i className="live-foot" /> SERVER-SYNCHRONIZED</span></footer>
  </main>
}

function sound(kind: 'ping' | 'switch' | 'danger' | 'tick' | 'win') {
  try { const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext; if (!AudioContextClass) return; const ctx = new AudioContextClass(); const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.type = kind === 'danger' ? 'sawtooth' : 'sine'; osc.frequency.value = kind === 'danger' ? 180 : kind === 'switch' ? 520 : kind === 'tick' ? 740 : kind === 'win' ? 660 : 420; if (kind === 'win') osc.frequency.setValueAtTime(880, ctx.currentTime + .12); gain.gain.setValueAtTime(.045, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + (kind === 'danger' ? .45 : kind === 'win' ? .42 : .12)); osc.start(); osc.stop(ctx.currentTime + .46); osc.onended = () => void ctx.close() } catch { /* Audio is an optional enhancement. */ }
}
