// scripts/deploy.js  (ESM, pure ethers v6 — no HRE)
// Run: npx hardhat run scripts/deploy.js --network avalancheFuji
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

/* ───────────── Network selection ───────────── */
const HH_NET = (process.env.HARDHAT_NETWORK || "").toLowerCase();
function modeFromNet(n) {
  if (n.includes("fuji")) return "fuji";
  if (n.includes("avalanche") || n.includes("avax")) return "mainnet";
  if (n.includes("hardhat") || n.includes("localhost")) return "local";
  return n || "unknown";
}
const MODE = modeFromNet(HH_NET || (process.env.NETWORK || "fuji"));

const CHAINS = {
  fuji: {
    chainId: 43113,
    rpc: "https://avalanche-fuji-c-chain-rpc.publicnode.com",
    explorer: "https://testnet.snowtrace.io",
    envKey: "NEXT_PUBLIC_FACTORY_FUJI",
  },
  mainnet: {
    chainId: 43114,
    rpc: process.env.RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
    envKey: "NEXT_PUBLIC_FACTORY_AVAX",
  },
  local: {
    chainId: 31337,
    rpc: "http://127.0.0.1:8545",
    explorer: "",
    envKey: "NEXT_PUBLIC_FACTORY_LOCAL",
  },
};

if (!CHAINS[MODE]) throw new Error(`Unknown/unsupported network mode: ${MODE}`);

/* ───────────── Wallet / Provider ───────────── */
const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

const provider = new ethers.JsonRpcProvider(CHAINS[MODE].rpc);
const wallet = new ethers.Wallet(PK, provider);

/* ───────────── Helpers ───────────── */
function artifact(rel) {
  // Requires "npx hardhat compile" to have produced artifacts/
  const p = resolve("artifacts/contracts", rel);
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveDeployment({ mode, chainId, deployer, factory, implementation, deployerContract, txs }) {
  const dir = resolve("deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `league-factory-${mode}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      { mode, chainId, deployer, factory, implementation, deployerContract, txs, deployedAt: new Date().toISOString() },
      null,
      2
    )
  );
  console.log(`📦 Wrote ${out}`);
}

function printEnvHint(mode, factoryAddr) {
  const key = CHAINS[mode]?.envKey || "NEXT_PUBLIC_FACTORY";
  console.log("\nPaste this into your frontend .env.local:");
  console.log(`\n${key}=${factoryAddr}\n`);
}

/* ───────────── Main ───────────── */
async function main() {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAINS[MODE].chainId) {
    throw new Error(`Connected chainId ${net.chainId} != expected ${CHAINS[MODE].chainId} (${MODE})`);
  }

  const bal = await provider.getBalance(wallet.address);
  console.log(`Network: ${MODE} (${net.chainId})`);
  console.log(`RPC:     ${CHAINS[MODE].rpc}`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} AVAX\n`);

  const explorer = CHAINS[MODE].explorer;
  const result = {
    mode: MODE,
    chainId: Number(net.chainId),
    deployer: wallet.address,
    txs: {},
  };

  // Detect contracts present in this repo
  const hasLeagueDeployer =
    existsSync(resolve("artifacts/contracts/LeagueDeployer.sol/LeagueDeployer.json")) ||
    existsSync(resolve("contracts/LeagueDeployer.sol"));
  const hasLeagueImpl =
    existsSync(resolve("artifacts/contracts/League.sol/League.json")) ||
    existsSync(resolve("contracts/League.sol"));

  if (!hasLeagueDeployer && !hasLeagueImpl) {
    throw new Error("No deployable contracts found. Compile first and ensure LeagueDeployer.sol or League.sol exists.");
  }

  // (A) LeagueDeployer + LeagueFactory(deployer)
  if (hasLeagueDeployer) {
    console.log("→ Deploying LeagueDeployer…");
    const depArt = artifact("LeagueDeployer.sol/LeagueDeployer.json");
    const DeployerCF = new ethers.ContractFactory(depArt.abi, depArt.bytecode, wallet);
    const deployer = await DeployerCF.deploy();
    const depTx = deployer.deploymentTransaction();
    const depRcpt = await depTx.wait();
    const deployerAddr = await deployer.getAddress();
    console.log(`✅ LeagueDeployer: ${deployerAddr} (template deployer)`);
    if (explorer) console.log(`📜 ${explorer}/tx/${depRcpt?.hash}`);

    result.deployerContract = deployerAddr;
    result.txs.deployerTx = depRcpt?.hash;

    console.log("\n→ Deploying LeagueFactory(deployer) …");
    const facArt = artifact("LeagueFactory.sol/LeagueFactory.json");
    const FactoryCF = new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet);
    const factory = await FactoryCF.deploy(deployerAddr);
    const facTx = factory.deploymentTransaction();
    const facRcpt = await facTx.wait();
    const factoryAddr = await factory.getAddress();
    console.log(`✅ LeagueFactory: ${factoryAddr} (USE THIS in your frontend .env)`);
    if (explorer) {
      console.log(`📜 ${explorer}/tx/${facRcpt?.hash}`);
      console.log(`📜 ${explorer}/address/${factoryAddr}`);
    }

    result.factory = factoryAddr;
    result.txs.factoryTx = facRcpt?.hash;

    saveDeployment(result);
    printEnvHint(MODE, factoryAddr);

    // Clean shutdown for ethers provider
    if (provider.destroy) await provider.destroy();
    return;
  }

  // (B) League (implementation) + LeagueFactory(implementation)
  if (hasLeagueImpl) {
    console.log("→ Deploying League (implementation) …");
    const implArt = artifact("League.sol/League.json");
    const ImplCF = new ethers.ContractFactory(implArt.abi, implArt.bytecode, wallet);
    const impl = await ImplCF.deploy();
    const implTx = impl.deploymentTransaction();
    const implRcpt = await implTx.wait();
    const implAddr = await impl.getAddress();
    console.log(`✅ League (impl): ${implAddr} (base implementation, not used directly)`);
    if (explorer) console.log(`📜 ${explorer}/tx/${implRcpt?.hash}`);

    result.implementation = implAddr;
    result.txs.implementationTx = implRcpt?.hash;

    console.log("\n→ Deploying LeagueFactory(implementation) …");
    const facArt = artifact("LeagueFactory.sol/LeagueFactory.json");
    const FactoryCF = new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet);
    const factory = await FactoryCF.deploy(implAddr);
    const facTx = factory.deploymentTransaction();
    const facRcpt = await facTx.wait();
    const factoryAddr = await factory.getAddress();
    console.log(`✅ LeagueFactory: ${factoryAddr} (USE THIS in your frontend .env)`);
    if (explorer) {
      console.log(`📜 ${explorer}/tx/${facRcpt?.hash}`);
      console.log(`📜 ${explorer}/address/${factoryAddr}`);
    }

    result.factory = factoryAddr;
    result.txs.factoryTx = facRcpt?.hash;

    saveDeployment(result);
    printEnvHint(MODE, factoryAddr);

    if (provider.destroy) await provider.destroy(); // clean shutdown
  }
}

/* Single invocation + guaranteed exit */
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
