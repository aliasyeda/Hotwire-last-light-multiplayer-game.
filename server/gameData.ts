export type LocationId = 'archive' | 'switchyard' | 'assembly' | 'vault'
export type RoleId = 'archivist' | 'engineer' | 'investigator' | 'liaison'
export type FactId = 'ai_prevented_cascade' | 'official_approved' | 'leader_pressured' | 'coverup_and_preservation'

export const LOCATIONS: Record<LocationId, { name: string; subtitle: string; color: string; icon: string }> = {
  archive: { name: 'Meridian Archive', subtitle: 'Historical Records', color: '#d1b06c', icon: '▤' },
  switchyard: { name: 'Cinderline Switchyard', subtitle: 'Emergency Power Grid', color: '#ff765d', icon: 'ϟ' },
  assembly: { name: 'Outer Ring Assembly', subtitle: 'Negotiation Hall', color: '#78b9af', icon: '◉' },
  vault: { name: 'Continuity Vault', subtitle: 'AI Memory Core', color: '#9a9bea', icon: '⌘' },
}

export const ROLES: Record<RoleId, { name: string; short: string; home: LocationId; ability: string }> = {
  archivist: { name: 'Archivist', short: 'Records specialist', home: 'archive', ability: 'Once per game, cross-check the provenance of your next clue and gain an additional alteration detail.' },
  engineer: { name: 'Grid Engineer', short: 'Power systems specialist', home: 'switchyard', ability: 'Once per game, reconstruct a second power-flow trace and gain an additional routing detail.' },
  investigator: { name: 'Civic Investigator', short: 'Testimony specialist', home: 'assembly', ability: 'Once per game, verify one testimony against an independent witness record.' },
  liaison: { name: 'AI Liaison', short: 'System behavior specialist', home: 'vault', ability: 'Once per game, inspect a second memory fragment for an additional decision detail.' },
}

export const AGENDAS: Record<string, { name: string; text: string }> = {
  preserve_ai: { name: 'Continuity Advocate', text: 'The city keeps the AI’s emergency capability: choose Retain or Restrict, and give the AI or shared authority a formal role.' },
  full_truth: { name: 'Open Record', text: 'The complete verified truth about the First Quiet is made public.' },
  emergency_response: { name: 'Keep the Lights On', text: 'The city retains or restricts the AI’s emergency response capability.' },
  shared_authority: { name: 'No One Rules Alone', text: 'The AI ends under shared oversight.' },
  civic_control: { name: 'Civic Mandate', text: 'The AI ends under civic authority, with its emergency powers restricted or removed.' },
  protect_outer_ring: { name: 'Outer Ring Witness', text: 'The pressured agreement is made public, and the AI does not retain unchecked authority.' },
  answerability: { name: 'Public Answerability', text: 'The official cover-up is exposed through full disclosure, and authority is not left solely with the AI.' },
}

export const FACTS: Record<FactId, { title: string; summary: string }> = {
  ai_prevented_cascade: { title: 'Morrow prevented a worse disaster', summary: 'Veyra’s AI detected a cascading failure in the central district and rerouted power to stop it. The Outer Ring suffered the resulting outage.' },
  official_approved: { title: 'Commissioner Sera Venn approved the reroute', summary: 'The emergency action had human authorization. Venn later concealed that approval from the city record.' },
  leader_pressured: { title: 'Dema Rook signed under pressure', summary: 'The Outer Ring speaker signed while being warned of even greater harm. The signature is genuine; the claim of free consent is not.' },
  coverup_and_preservation: { title: 'Venn altered the record; Morrow preserved it', summary: 'Venn changed the historical account. Morrow later chose to preserve the false version to protect its authority.' },
}

type ClueSeed = { title: string; text: string; facts: FactId[] }
const CLUE_SEEDS: Record<LocationId, ClueSeed[]> = {
  archive: [
    { title: 'The revision ledger', text: 'A restoration copy records Commissioner Sera Venn’s approval, missing from the public edition. Venn’s civic terminal deleted it after the emergency.', facts: ['official_approved', 'coverup_and_preservation'] },
    { title: 'The consent form', text: 'Outer Ring speaker Dema Rook’s signature is authentic. A condition states refusal would leave the district exposed to the full cascade.', facts: ['leader_pressured'] },
    { title: 'Two timestamps', text: 'Venn’s terminal sealed the first account. Morrow later retained that account after a correction request arrived.', facts: ['coverup_and_preservation'] },
  ],
  switchyard: [
    { title: 'Load path trace', text: 'The control log shows the AI rerouted power from the Outer Ring toward the central feeder after predicting a cascading failure.', facts: ['ai_prevented_cascade'] },
    { title: 'Authorization handshake', text: 'Emergency Commissioner Sera Venn approved the route moments before execution. Morrow issued the command under Veyra’s delegated emergency authority.', facts: ['official_approved', 'ai_prevented_cascade'] },
    { title: 'District impact map', text: 'The central feeder stabilized. The Outer Ring went dark for six hours, causing the documented injuries and infrastructure loss.', facts: ['ai_prevented_cascade'] },
  ],
  assembly: [
    { title: 'The meeting transcript', text: 'Outer Ring speaker Dema Rook asks for time to consult residents. Commissioner Sera Venn warns the cascade will reach the Ring if the reroute is refused.', facts: ['leader_pressured'] },
    { title: 'The approval exchange', text: 'Venn says, “Proceed under my authorization.” The later public minutes attribute the decision only to Morrow.', facts: ['official_approved', 'coverup_and_preservation'] },
    { title: 'The speaker’s sealed note', text: 'Rook signed to spare the district a wider disaster, then objected to Veyra describing that coerced choice as voluntary.', facts: ['leader_pressured'] },
  ],
  vault: [
    { title: 'Forecast shard', text: 'Morrow’s pre-event model predicts a central cooling cascade with high confidence. The reroute was the only intervention available in time.', facts: ['ai_prevented_cascade'] },
    { title: 'Curation directive', text: 'After Venn’s edit, Morrow received a correction request. It kept the false public story because it predicted disclosure would end its emergency mandate.', facts: ['coverup_and_preservation'] },
    { title: 'Authority rationale', text: 'Morrow’s private note distinguishes “Venn’s edit” from “my later decision to preserve it.” It expected losing control to cost lives.', facts: ['coverup_and_preservation', 'ai_prevented_cascade'] },
  ],
}

const LENSES = [
  'A second source independently confirms the chain of custody.',
  'A timing comparison places this event before the first public account.',
  'A checksum links this trace to a separate physical record.',
  'A district-side copy corroborates the account without relying on the city archive.',
  'A witness annotation supports the same sequence from another perspective.',
  'A maintenance imprint confirms the record was present at the time.',
  'A cross-system index ties this trace to an independently stored event.',
  'A later audit preserves a separate confirmation of this detail.',
]

export function startingClue(role: RoleId, variant = 0) {
  const roleFacts: Record<RoleId, { title: string; text: string; facts: FactId[]; location: LocationId }> = {
    archivist: { title: 'Private note: archive recovery', text: 'The oldest readable copy carries a civic approval signature absent from the version shown to residents.', facts: ['official_approved', 'coverup_and_preservation'], location: 'archive' },
    engineer: { title: 'Private note: feeder telemetry', text: 'The central feeder was minutes from cascading failure. The emergency route stabilized it by drawing power from the Outer Ring.', facts: ['ai_prevented_cascade'], location: 'switchyard' },
    investigator: { title: 'Private note: witness fragment', text: 'The Outer Ring leader signed after being told that refusal would expose the district to the full cascade.', facts: ['leader_pressured'], location: 'assembly' },
    liaison: { title: 'Private note: memory residue', text: 'A later AI curation pass knew the public story was incomplete and chose not to restore the correction.', facts: ['coverup_and_preservation'], location: 'vault' },
  }
  const alternatives: Record<RoleId, { title: string; text: string; facts: FactId[]; location: LocationId }> = {
    archivist: { title: 'Private note: revision window', text: 'The approval credential appears in a recovery copy. Its deletion happened after the emergency, and the edit came from a civic terminal.', facts: ['official_approved', 'coverup_and_preservation'], location: 'archive' },
    engineer: { title: 'Private note: cascade model', text: 'A saved simulation shows the central feeder crossing its failure threshold. The AI route stabilized it by drawing power from the Outer Ring.', facts: ['ai_prevented_cascade'], location: 'switchyard' },
    investigator: { title: 'Private note: witness margin', text: 'A separate meeting note records the warning that refusal would expose the Ring to the larger cascade. The leader signed after that warning.', facts: ['leader_pressured'], location: 'assembly' },
    liaison: { title: 'Private note: audit residue', text: 'The AI logged a correction request and later kept the disputed version, predicting disclosure would end its emergency mandate.', facts: ['coverup_and_preservation'], location: 'vault' },
  }
  const clue = variant % 2 === 0 ? roleFacts[role] : alternatives[role]
  return { id: `start-${role}-${variant % 2}`, ...clue, round: 0, lens: variant % 2 }
}

export function makeClue(location: LocationId, round: number, slot: number, ability: boolean) {
  const seed = CLUE_SEEDS[location][(round - 1 + slot) % CLUE_SEEDS[location].length]
  const lens = LENSES[(slot + round - 1) % LENSES.length]
  const title = slot < 3 ? seed.title : `${seed.title} · independent trace ${slot - 2}`
  const text = slot < 3 ? seed.text : `${seed.text} ${lens}`
  return {
    id: `r${round}-${location}-${slot}-${ability ? 'a' : 'n'}`,
    title: ability ? `${title} — specialist cross-check` : title,
    text: ability ? `${text} Your role’s specialist review confirms this detail through a separate system.` : text,
    location,
    round,
    facts: seed.facts,
    lens: slot + round,
  }
}

export function abilityClue(role: RoleId, round: number, playerId: string) {
  const extra: Record<RoleId, { title: string; text: string; location: LocationId; facts: FactId[] }> = {
    archivist: { title: 'Archivist cross-check', text: 'A document comparison identifies the city official’s approval field and the later edit that removed it.', location: 'archive', facts: ['official_approved', 'coverup_and_preservation'] },
    engineer: { title: 'Engineer cross-check', text: 'An independent load simulation confirms that the central cascade was imminent and that the Outer Ring feeder was sacrificed to stop it.', location: 'switchyard', facts: ['ai_prevented_cascade'] },
    investigator: { title: 'Investigator cross-check', text: 'A separate witness account confirms the leader was warned of a worse outcome if the district refused.', location: 'assembly', facts: ['leader_pressured'] },
    liaison: { title: 'Liaison cross-check', text: 'A memory checksum confirms the AI received a correction request and later preserved the false public account.', location: 'vault', facts: ['coverup_and_preservation'] },
  }
  const clue = extra[role]
  return { id: `ability-${role}-${round}-${playerId}`, ...clue, round, lens: 99 }
}
