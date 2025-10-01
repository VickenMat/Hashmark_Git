// src/lib/league-abi.ts
export const LEAGUE_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function', name: 'getTeams', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'tuple[]', components: [{ name: 'owner', type: 'address' }, { name: 'name', type: 'string' }]}],
  },
  {
    // draftType(uint8), draftTimestamp(uint64), orderMode(uint8), completed(bool), manual(address[]), picksTrading(bool)
    type: 'function', name: 'getDraftSettings', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'uint8' }, { type: 'uint64' }, { type: 'uint8' }, { type: 'bool' }, { type: 'address[]' }, { type: 'bool' }],
  },
  {
    // authoritative “chips” (UX extras)
    type: 'function', name: 'getDraftExtras', stateMutability: 'view', inputs: [],
    outputs: [{
      type: 'tuple', components: [
        { name: 'timePerPickSeconds', type: 'uint32' },
        { name: 'thirdRoundReversal', type: 'bool' },
        { name: 'salaryCapBudget',    type: 'uint32' },
        { name: 'playerPool',         type: 'uint8'  },
      ]
    }]
  },
  {
    type: 'function', name: 'setDraftSettings', stateMutability: 'nonpayable',
    inputs: [
      { name: '_draftType', type: 'uint8' },
      { name: '_draftTimestamp', type: 'uint64' },
      { name: '_orderMode', type: 'uint8' },
      { name: '_manualOrder', type: 'address[]' },
      { name: '_draftCompleted', type: 'bool' },
      { name: '_draftPickTradingEnabled', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'setDraftExtras', stateMutability: 'nonpayable',
    inputs: [
      { name: '_timePerPickSeconds', type: 'uint32' },
      { name: '_thirdRoundReversal', type: 'bool'   },
      { name: '_salaryCapBudget',    type: 'uint32' },
      { name: '_playerPool',         type: 'uint8'  },
    ],
    outputs: []
  },
  { type: 'function', name: 'commissioner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

export type LeagueAbi = typeof LEAGUE_ABI;
