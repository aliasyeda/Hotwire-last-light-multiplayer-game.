# HOTWIRE: LAST LIGHT

A live co-op grid survival game for 2–8 players. Players join from separate browsers using a five-character room code. No account or installation is needed.

## Play locally

1. Install Node.js 20.19+ or 22.12+.
2. In this folder run `npm install` once.
3. Run `npm run dev`.
4. Open the Vite address printed in the terminal (normally `http://localhost:5173`) in two browser windows. For a second device on the same Wi-Fi, open the computer's network address printed by Vite.
5. Create a room in one window, copy its code, join from the other, then start.

The combined server and production client can be run with `npm run build` followed by `npm start`. The Node server uses `PORT` when set and serves both the frontend and Socket.IO on the same origin. The health endpoint is `/health`.

## How to play

- The crew gets 90 seconds to keep at least two of three city districts powered: Hospital, Water Plant, and Shelter.
- Every player owns one or more of the eight relays. A two-player crew gets four relays each; with more players, every player still owns at least one.
- The server sends power pulses across the grid. Each pulse shows which district needs its power. Tap one of your relays before the pulse arrives to cycle its destination: Hospital → Water Plant → Shelter.
- Correct routes refill the requested district, lower overload, and score points. A misroute gives only a small refill and raises overload.
- Surges, demand spikes, and relay fuse failures appear with a warning. The crew has two shared emergency vents; a vent lowers overload by 22 and adds 12 power to the chosen district.
- Lose if overload reaches 100, two districts go dark, or time expires without two districts still online. Reach the end with at least two districts alive to win. A rematch changes the grid layout and event sequence.
- Quick-call buttons send short synchronized alerts. Sound can be muted; reduced-motion preferences are respected.

## Multiplayer and privacy

The Node/Socket.IO server owns the match clock, pulse movement and targets, relay ownership, events, batteries, overload, vents, scoring, win/loss, and rematches. The browser only requests actions. Room seats use a random saved reconnect token; the server stores its hash. If someone disconnects, their relay controls are redistributed among the connected crew and return to them if they reconnect. Room state currently lives in server memory, so a server restart or redeploy ends active rooms.

## Automated multiplayer check

Run `npm run build` and `npm run smoke:multiplayer`. The multiplayer script starts a temporary local Socket.IO server with a shortened match and checks room creation/joining, two-player relay coverage, server-enforced relay ownership, reconnecting to a live match, quick calls, vents, a complete win, rematch layout rotation, eight-player relay coverage, and rejection of a ninth player.

## Public hosting

The included `render.yaml` configures one Render Node web service. Connect the repository to Render and deploy the blueprint. No API keys or third-party credentials are required. Render sets `PORT`; no other environment variable is required. Web and Socket.IO traffic share the same service and origin. Free services may sleep when idle, and rooms are cleared if the process restarts.
