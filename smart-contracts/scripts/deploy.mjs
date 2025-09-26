// scripts/deploy.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import "dotenv/config";

const MODE = (process.env.NETWORK || "fuji").toLowerCase();

const CHAINS = {
  fuji: {
    chainId: 43113,
    rpc:
      process.env.RPC_URL_FUJI ||
      process.env.AVAX_FUJI_RPC ||
      "https://api.avax-test.network/ext/bc/C/rpc",
    explorer: "https://testnet.snowtrace.io",
  },
  mainnet: {
    chainId: 43114,
    rpc:
      process.env.RPC_URL ||
      process.env.AVAX_MAINNET_RPC ||
      "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
  },
};

if (!(MODE in CHAINS)) throw new Error(`Unknown NETWORK=${MODE}`);

const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

const provider = new ethers.JsonRpcProvider(CHAINS[MODE].rpc);
const wallet = new ethers.Wallet(PK, provider);

function artifact(rel) {
  return JSON.parse(readFileSync(resolve("artifacts/contracts", rel), "utf8"));
}

function saveDeployment({ mode, chainId, factory, tx }) {
  const dir = resolve("deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `league-factory-${mode}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      { mode, chainId, factory, tx, deployedAt: new Date().toISOString() },
      null,
      2
    )
  );
  console.log(`📦 Wrote ${out}`);
}

async function main() {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAINS[MODE].chainId) {
    throw new Error(
      `Connected to chainId ${net.chainId}, expected ${CHAINS[MODE].chainId} for ${MODE}`
    );
  }

  const bal = await provider.getBalance(wallet.address);
  console.log(`Network: ${MODE} (${net.chainId})`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} AVAX`);

  const { abi, bytecode } = artifact("LeagueFactory.sol/LeagueFactory.json");
  const Factory = new ethers.ContractFactory(abi, bytecode, wallet);

  // Gas preview (non-blocking)
  try {
    const unsigned = Factory.getDeployTransaction();
    const gas = await provider.estimateGas({ ...unsigned, from: wallet.address });
    const fees = await provider.getFeeData();
    console.log(
      `Estimated deploy gas: ${gas} | maxFeePerGas: ${fees.maxFeePerGas?.toString()} wei`
    );
  } catch {
    console.log("⚠️  Gas preview unavailable (continuing)");
  }

  // Deploy
  const factory = await Factory.deploy();
  const deployTx = factory.deploymentTransaction();
  console.log("⛓️  Sending deploy tx…", deployTx?.hash || "");
  const rcpt = await deployTx.wait();
  const addr = await factory.getAddress();
  console.log("✅ LeagueFactory:", addr);
  console.log("   tx:", rcpt?.hash);
  console.log(
    `🔎 ${CHAINS[MODE].explorer}/tx/${rcpt?.hash}\n🔎 ${CHAINS[MODE].explorer}/address/${addr}`
  );

  saveDeployment({
    mode: MODE,
    chainId: Number(net.chainId),
    factory: addr,
    tx: rcpt?.hash,
  });

  // ───────────────────────────────────────────────────────────────
  // AUTO-SEED (commented out by default)
  //
  // Uncomment to create a league immediately after deploying.
  // The commissioner will be the DEPLOYER wallet (wallet.address).
  //
  // const name = process.env.SEED_NAME || "League 1";
  // const teamCap = BigInt(process.env.SEED_TEAMS || "12");
  // const buyIn = BigInt(process.env.SEED_BUYIN || "0"); // native units
  // console.log(`🌱 Seeding league: "${name}" teamCap=${teamCap} buyIn=${buyIn}…`);
  // const tx = await factory.createLeague(name, buyIn, teamCap);
  // const mined = await tx.wait();
  // const all = await factory.getLeagues();
  // console.log("🧱 createLeague tx:", mined?.hash);
  // console.log(
  //   `🎯 New League: ${all[all.length - 1]} (${CHAINS[MODE].explorer}/tx/${mined?.hash})`
  // );
  // ───────────────────────────────────────────────────────────────
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
