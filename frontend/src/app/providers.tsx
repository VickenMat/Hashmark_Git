'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { ReactNode } from 'react';

import { WagmiProvider, http } from 'wagmi';
import { avalanche, avalancheFuji } from 'wagmi/chains';
import {
  getDefaultConfig,
  RainbowKitProvider,
  darkTheme,
} from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* ========= env + helpers ========= */
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_ID ||
  'cb10761d4129f940cebe571c55a11b8f'; // dev fallback

const FUJI_RPC =
  process.env.NEXT_PUBLIC_RPC_FUJI ||
  process.env.NEXT_PUBLIC_AVAX_FUJI_RPC; // support either key

const MAINNET_RPC =
  process.env.NEXT_PUBLIC_RPC_MAINNET ||
  process.env.NEXT_PUBLIC_AVAX_MAINNET_RPC;

const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 43113);
const DEFAULT_CHAIN = envChainId === avalanche.id ? avalanche : avalancheFuji;
const OTHER_CHAIN = DEFAULT_CHAIN.id === avalanche.id ? avalancheFuji : avalanche;

/* ========= singletons (module scope!) ========= */
export const wagmiConfig = getDefaultConfig({
  appName: 'Hashmark',
  projectId: WC_PROJECT_ID,
  // Put the default chain first so RainbowKit highlights it
  chains: [DEFAULT_CHAIN, OTHER_CHAIN],
  transports: {
    [avalancheFuji.id]: FUJI_RPC ? http(FUJI_RPC) : http(),
    [avalanche.id]: MAINNET_RPC ? http(MAINNET_RPC) : http(),
  },
  ssr: true,
});

const queryClient = new QueryClient();

/* ========= provider tree ========= */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme()}
          modalSize="compact"
          showRecentTransactions
          initialChain={DEFAULT_CHAIN}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
