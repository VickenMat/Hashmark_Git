/** ------------------------------------------------------------------
 * Addresses (runtime selected by chain)
 * - Prefer env vars so you never edit code after redeploys.
 * - Keep both; we'll choose based on chainId at runtime.
 * ------------------------------------------------------------------ */
// src/lib/LeagueContracts.js

export const ADDRESSES = {
  fuji: process.env.NEXT_PUBLIC_FACTORY_FUJI || undefined,
  mainnet: process.env.NEXT_PUBLIC_FACTORY_MAINNET || undefined,
};

/** Legacy default (prefer factoryAddressForChain(chainId) in app code) */
export const LEAGUE_FACTORY_ADDRESS = ADDRESSES.fuji;

/** Choose the factory for the current chain (43113 Fuji, 43114 Mainnet) */
export function factoryAddressForChain(chainId) {
  if (chainId === 43113) return ADDRESSES.fuji;     // Avalanche Fuji
  if (chainId === 43114) return ADDRESSES.mainnet;  // Avalanche C-Chain
  return ADDRESSES.fuji || ADDRESSES.mainnet || undefined; // dev fallback
}

/** Handy constant */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** ------------------------------------------------------------------
 * LeagueFactory ABI (minimal)
 *  - getLeagues() is optional on some deploys; we also export the event
 *    to allow a logs-based fallback in the UI.
 * ------------------------------------------------------------------ */
export const LEAGUE_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createLeague',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_buyInAmount', type: 'uint256' },
      { name: '_teamCount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createLeagueERC20',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_token', type: 'address' },
      { name: '_buyInAmount', type: 'uint256' },
      { name: '_teamCount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getLeagues',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getLeaguesByCreator',
    stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'event',
    name: 'LeagueCreated',
    inputs: [
      { name: 'leagueAddress', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      // Some older factories also include name(string) non-indexed; harmless if absent
      // { name: 'name', type: 'string', indexed: false },
    ],
    anonymous: false,
  },
];

/** Export the event definition alone for getLogs() callers if desired */
export const LEAGUE_CREATED_EVENT = {
  type: 'event',
  name: 'LeagueCreated',
  inputs: [
    { name: 'leagueAddress', type: 'address', indexed: true },
    { name: 'creator', type: 'address', indexed: true },
  ],
  anonymous: false,
};

/** ------------------------------------------------------------------
 * League ABI (reads + writes used by the app)
 *  – Matches your hardened League.sol
 * ------------------------------------------------------------------ */
export const LEAGUE_ABI = [
  // Core public vars
  { type: 'function', name: 'name',             stateMutability: 'view', inputs: [], outputs: [{ type: 'string'  }] },
  { type: 'function', name: 'commissioner',     stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'createdAt',        stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'buyInToken',       stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'buyInAmount',      stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'teamCap',          stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'teamsFilled',      stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },

  // Access / password
  { type: 'function', name: 'requiresPassword', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'    }] },
  {
    type: 'function', name: 'setJoinPassword',  stateMutability: 'nonpayable',
    inputs: [{ name: 'passwordHash', type: 'bytes32' }], outputs: [],
  },

  // Join / create / payments
  {
    type: 'function', name: 'joinLeague',       stateMutability: 'payable',
    inputs: [
      { name: '_teamName', type: 'string' },
      { name: 'password',  type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'joinLeagueWithSig', stateMutability: 'payable',
    inputs: [
      { name: '_teamName', type: 'string' },
      { name: 'deadline',  type: 'uint256' },
      { name: 'sig',       type: 'bytes'   },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'createTeam',       stateMutability: 'nonpayable',
    inputs: [
      { name: '_teamName', type: 'string' },
      { name: 'password',  type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'createTeamWithSig', stateMutability: 'nonpayable',
    inputs: [
      { name: '_teamName', type: 'string' },
      { name: 'deadline',  type: 'uint256' },
      { name: 'sig',       type: 'bytes'   },
    ],
    outputs: [],
  },
  { type: 'function', name: 'payBuyIn',         stateMutability: 'payable', inputs: [], outputs: [] },

  // Teams & profiles
  {
    type: 'function',
    name: 'getTeams',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'name',  type: 'string'  },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getTeamByAddress',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'getTeamProfile',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'string' }, { type: 'string' }, { type: 'uint64' }],
  },
  { type: 'function', name: 'isMember',         stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'setTeamName',      stateMutability: 'nonpayable', inputs: [{ name: 'newName', type: 'string' }], outputs: [] },
  {
    type: 'function', name: 'setTeamProfile',   stateMutability: 'nonpayable',
    inputs: [{ name: 'newName', type: 'string' }, { name: 'newLogoURI', type: 'string' }],
    outputs: [],
  },

  // Escrow & payments (views)
  {
    type: 'function',
    name: 'escrowBalances',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
  },
  { type: 'function', name: 'outstandingOf',    stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'hasPaid',          stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },

  // Draft settings (packed getter used by UI)
  {
    type: 'function',
    name: 'getDraftSettings',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint8'   },  // draftType
      { type: 'uint64'  },  // draftTimestamp
      { type: 'uint8'   },  // orderMode
      { type: 'bool'    },  // draftCompleted
      { type: 'address[]' },// manualDraftOrder
      { type: 'bool'    },  // draftPickTradingEnabled
    ],
  },

  /* --- Writable settings expected by LM Tools (enable if your contract supports them) --- */
  { type: 'function', name: 'setName',             stateMutability: 'nonpayable', inputs: [{ name: 'newName', type: 'string' }], outputs: [] },
  { type: 'function', name: 'setRequiresPassword', stateMutability: 'nonpayable', inputs: [{ name: 'required', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setTeamCap',          stateMutability: 'nonpayable', inputs: [{ name: 'cap', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'setBuyIn',            stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
];

/** ------------------------------------------------------------------
 * Helper: check if a function exists on the League ABI
 * ------------------------------------------------------------------ */
export function leagueAbiHas(fnName) {
  try {
    if (!Array.isArray(LEAGUE_ABI)) return false;
    return LEAGUE_ABI.some(
      (f) => f && f.type === 'function' && typeof f.name === 'string' && f.name === fnName
    );
  } catch {
    return false;
  }
}
