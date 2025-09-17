import type { GetLogsParameters, Log, PublicClient } from 'viem';

/**
 * getLogs over many blocks by chunking ranges to satisfy RPC limits.
 * Default chunk is 1800 blocks (under Fuji’s ~2048 limit).
 */
export async function getLogsChunked(
  client: PublicClient,
  params: Omit<GetLogsParameters, 'fromBlock' | 'toBlock'> & {
    fromBlock: bigint;
    toBlock?: bigint;
    chunkSize?: bigint;
  }
): Promise<Log[]> {
  const latest = params.toBlock ?? await client.getBlockNumber();
  const size = params.chunkSize ?? 1800n;

  const out: Log[] = [];
  let from = params.fromBlock;
  while (from <= latest) {
    const to = (from + size - 1n) > latest ? latest : (from + size - 1n);
    const logs = await client.getLogs({ ...params, fromBlock: from, toBlock: to });
    out.push(...logs);
    if (to === latest) break;
    from = to + 1n;
  }
  return out;
}
