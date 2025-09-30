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

if (!CHAINS[MODE]) throw new Error(`Unknown NETWORK=${MODE}`);

const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

const provider = new ethers.JsonRpcProvider(CHAINS[MODE].rpc);
const wallet = new ethers.Wallet(PK, provider);

function artifact(rel) {
  // Hardhat must have compiled first (artifacts/… exists)
  const p = resolve("artifacts/contracts", rel);
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveDeployment({ mode, chainId, deployer, factory, txs }) {
  const dir = resolve("deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `league-factory-${mode}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        mode,
        chainId,
        deployer,
        factory,
        txs, // {deployerTx, factoryTx}
        deployedAt: new Date().toISOString(),
      },
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
      `Connected chainId ${net.chainId} != expected ${CHAINS[MODE].chainId} (${MODE})`
    );
  }

  const bal = await provider.getBalance(wallet.address);
  console.log(`Network: ${MODE} (${net.chainId})`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} AVAX`);

  // ─────────────────────────────
  // 1) Deploy LeagueDeployer
  // ─────────────────────────────
  const depArt = artifact("LeagueDeployer.sol/LeagueDeployer.json");
  const DeployerCF = new ethers.ContractFactory(depArt.abi, depArt.bytecode, wallet);

  // (Optional) gas preview
  try {
    const unsigned = DeployerCF.getDeployTransaction();
    const gas = await provider.estimateGas({ ...unsigned, from: wallet.address });
    const fees = await provider.getFeeData();
    console.log(
      `Deployer gas est: ${gas} | maxFeePerGas: ${fees.maxFeePerGas?.toString()} wei`
    );
  } catch { console.log("⚠️  Deployer gas preview unavailable (continuing)"); }

  const deployer = await DeployerCF.deploy();
  const depTx = deployer.deploymentTransaction();
  console.log("⛓️  LeagueDeployer tx…", depTx?.hash || "");
  const depRcpt = await depTx.wait();
  const deployerAddr = await deployer.getAddress();
  console.log("✅ LeagueDeployer:", deployerAddr);
  console.log("   tx:", depRcpt?.hash);
  console.log(`🔎 ${CHAINS[MODE].explorer}/tx/${depRcpt?.hash}`);

  // ─────────────────────────────
  // 2) Deploy LeagueFactory(deployer)
  // ─────────────────────────────
  const facArt = artifact("LeagueFactory.sol/LeagueFactory.json");
  const FactoryCF = new ethers.ContractFactory(facArt.abi, facArt.bytecode, wallet);

  try {
    const unsigned = FactoryCF.getDeployTransaction(deployerAddr);
    const gas = await provider.estimateGas({ ...unsigned, from: wallet.address });
    const fees = await provider.getFeeData();
    console.log(
      `Factory gas est: ${gas} | maxFeePerGas: ${fees.maxFeePerGas?.toString()} wei`
    );
  } catch { console.log("⚠️  Factory gas preview unavailable (continuing)"); }

  const factory = await FactoryCF.deploy(deployerAddr);
  const facTx = factory.deploymentTransaction();
  console.log("⛓️  LeagueFactory tx…", facTx?.hash || "");
  const facRcpt = await facTx.wait();
  const factoryAddr = await factory.getAddress();
  console.log("✅ LeagueFactory:", factoryAddr);
  console.log("   tx:", facRcpt?.hash);
  console.log(
    `🔎 ${CHAINS[MODE].explorer}/tx/${facRcpt?.hash}\n🔎 ${CHAINS[MODE].explorer}/address/${factoryAddr}`
  );

  saveDeployment({
    mode: MODE,
    chainId: Number(net.chainId),
    deployer: deployerAddr,
    factory: factoryAddr,
    txs: { deployerTx: depRcpt?.hash, factoryTx: facRcpt?.hash },
  });

  // ───────────────────────────────────────────────
  // 3) (Optional) Auto-seed a first league
  // ───────────────────────────────────────────────
  // const name = process.env.SEED_NAME || "League 1";
  // const teamCap = BigInt(process.env.SEED_TEAMS || "12");
  // const buyIn = BigInt(process.env.SEED_BUYIN || "0"); // in wei (native)
  // console.log(`🌱 Seeding league: "${name}" teams=${teamCap} buyIn=${buyIn}…`);
  // const tx = await factory.createLeague(name, buyIn, teamCap);
  // const mined = await tx.wait();
  // const all = await factory.getLeagues();
  // console.log("🧱 createLeague tx:", mined?.hash);
  // console.log(`🎯 New League: ${all[all.length - 1]}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
