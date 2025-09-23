// Hardhat v3 – ESM config
import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 100 },
      viaIR: true,
    },
  },

  networks: {
    // internal simulator
    hardhat: {
      type: "edr-simulated",
    },

    // external RPCs must declare type: "http"
    avalancheFuji: {
      type: "http",
      url: process.env.RPC_URL_FUJI || "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 43113,
    },
    avalanche: {
      type: "http",
      url: process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 43114,
    },
  },

  // optional, fine to keep for Snowtrace verification later
  etherscan: {
    apiKey: {
      avalancheFuji: process.env.SNOWTRACE_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
    },
  },
};

export default config;
