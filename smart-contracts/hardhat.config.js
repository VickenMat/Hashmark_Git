// hardhat.config.js (ESM, Hardhat 3.x)
import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          metadata: { bytecodeHash: "none" },
        },
      },
    ],
    overrides: {
      "contracts/League.sol": {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 400 },
          viaIR: true,
          metadata: { bytecodeHash: "none" },
        },
      },
      "contracts/LeagueFactory.sol": {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 50 },
          viaIR: false,
          metadata: { bytecodeHash: "none" },
        },
      },
    },
  },

  networks: {
    // Local Hardhat (v3 requires a type)
    hardhat: {
      type: "edr-simulated",
    },

    // Avalanche Fuji testnet
    avalancheFuji: {
      type: "http",
      url: "https://avalanche-fuji-c-chain-rpc.publicnode.com",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 43113,
    },

    // Avalanche mainnet
    avalanche: {
      type: "http",
      url: process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 43114,
    },
  },

  etherscan: {
    apiKey: {
      avalancheFuji: process.env.SNOWTRACE_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
    },
  },
};

export default config;
