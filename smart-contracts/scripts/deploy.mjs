// const hre = require("hardhat");

// async function main() {
//   const [deployer] = await hre.ethers.getSigners();
//   console.log("Deploying contracts with account:", deployer.address);

//   const LeagueFactory = await hre.ethers.getContractFactory("LeagueFactory");
//   const factory = await LeagueFactory.deploy();

//   await factory.waitForDeployment(); // ✅ instead of .deployed()

//   const deployedAddress = await factory.getAddress();
//   console.log("LeagueFactory deployed to:", deployedAddress);
// }

// main().catch((error) => {
//   console.error(error);
//   process.exitCode = 1;
// });

import { readFileSync } from "node:fs";
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
  },
  mainnet: {
    chainId: 43114,
    rpc:
      process.env.RPC_URL ||
      process.env.AVAX_MAINNET_RPC ||
      "https://api.avax.network/ext/bc/C/rpc",
  },
};

if (!(MODE in CHAINS)) throw new Error(`Unknown NETWORK=${MODE}`);

const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("Set PRIVATE_KEY in smart-contracts/.env");

const provider = new ethers.JsonRpcProvider(CHAINS[MODE].rpc);
const wallet = new ethers.Wallet(PK, provider);

function artifact(rel) {
  return JSON.parse(
    readFileSync(resolve("artifacts/contracts", rel), "utf8")
  );
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

  // (optional) print a gas estimate
  const unsigned = Factory.getDeployTransaction();
  const gas = await provider.estimateGas({ ...unsigned, from: wallet.address });
  const fees = await provider.getFeeData();
  console.log(
    `Estimated deploy gas: ${gas} | maxFeePerGas: ${fees.maxFeePerGas?.toString()} wei`
  );

  const factory = await Factory.deploy();
  const rcpt = await factory.deploymentTransaction().wait();
  const addr = await factory.getAddress();
  console.log("✅ LeagueFactory:", addr);
  console.log("   tx:", rcpt?.hash);

  // Optional: auto-create a sample league (default OFF on mainnet)
  const create =
    (process.env.CREATE_LEAGUE || "").toLowerCase() === "true" ||
    MODE === "fuji";

  if (create) {
    const tx = await factory.createLeague("League 2", 0n, 12);
    const mined = await tx.wait();
    const all = await factory.getLeagues();
    console.log("🧱 createLeague tx:", mined?.hash);
    console.log("🎯 New League:", all[all.length - 1]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
