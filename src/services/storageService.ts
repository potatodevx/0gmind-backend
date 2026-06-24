import { ethers } from 'ethers';
import { Indexer } from '@0glabs/0g-ts-sdk';
import { ZeroGStorageUploadResult } from '../types';

const ZERO_G_RPC = process.env.ZERO_G_RPC || 'https://evmrpc-testnet.0g.ai';
const ZERO_G_STORAGE_INDEXER =
  process.env.ZERO_G_STORAGE_INDEXER ||
  'https://indexer-storage-testnet-turbo.0g.ai';
const PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || '';

// ─── Encryption helpers (XOR — demo-grade, sufficient for hackathon) ──────────
export function encryptContent(content: string): { encrypted: string; key: string } {
  const key = ethers.hexlify(ethers.randomBytes(32));
  const contentBytes = Buffer.from(content, 'utf8');
  const keyBytes = Buffer.from(key.slice(2), 'hex');
  const encrypted = Buffer.alloc(contentBytes.length);
  for (let i = 0; i < contentBytes.length; i++) {
    encrypted[i] = contentBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return { encrypted: encrypted.toString('base64'), key };
}

export function decryptContent(encrypted: string, key: string): string {
  const encryptedBytes = Buffer.from(encrypted, 'base64');
  const keyBytes = Buffer.from(key.slice(2), 'hex');
  const decrypted = Buffer.alloc(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return decrypted.toString('utf8');
}

// ─── Upload ────────────────────────────────────────────────────────────────────
export async function uploadToZeroGStorage(
  content: string,
  metadata: Record<string, unknown>
): Promise<ZeroGStorageUploadResult> {
  const payload = JSON.stringify({
    content,
    metadata,
    timestamp: Date.now(),
    version: '1.0',
  });

  const dataBuffer = Buffer.from(payload, 'utf8');

  // ── No private key → deterministic mock (dev only) ──
  if (!PRIVATE_KEY) {
    console.warn('[0G Storage] BACKEND_PRIVATE_KEY not set — using deterministic mock. Set it to use real 0G Storage.');
    const rootHash = ethers.keccak256(dataBuffer);
    return {
      rootHash,
      txHash: ethers.keccak256(Buffer.from('mock-tx-' + Date.now())),
      size: dataBuffer.length,
    };
  }

  // ── Real upload via @0glabs/0g-ts-sdk ──────────────────────────────────────
  try {
    const provider = new ethers.JsonRpcProvider(ZERO_G_RPC);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const indexer = new Indexer(ZERO_G_STORAGE_INDEXER);

    // Write payload to a temp file so the SDK can build the merkle tree
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpFile = path.join(os.tmpdir(), `0gmind-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, payload, 'utf8');

    // The SDK needs a ZgFile — import dynamically to avoid ESM issues
    const { ZgFile } = await import('@0glabs/0g-ts-sdk');
    const zgFile = await ZgFile.fromFilePath(tmpFile);
    const [tree, treeErr] = await zgFile.merkleTree();
    if (treeErr !== null) throw new Error(`Merkle tree error: ${treeErr}`);

    const rootHash = (tree as { rootHash(): string }).rootHash();
    console.log('[0G Storage] Uploading blob, root hash:', rootHash);

    const [tx, uploadErr] = await indexer.upload(zgFile, ZERO_G_RPC, signer);
    if (uploadErr !== null) throw new Error(`Upload error: ${uploadErr}`);

    await zgFile.close();
    fs.unlinkSync(tmpFile);

    // The SDK returns either { rootHash, txHash } or { rootHashes, txHashes }
    const txResult = tx as unknown as { txHash?: string; txHashes?: string[] };
    const txHash = txResult.txHash ?? txResult.txHashes?.[0] ?? '0x' + '0'.repeat(64);

    console.log('[0G Storage] Upload success. txHash:', txHash);
    return { rootHash, txHash, size: dataBuffer.length };
  } catch (error) {
    console.error('[0G Storage] Upload failed, falling back to hash-only:', error);
    // Deterministic fallback — blob ID derived from content hash
    const rootHash = ethers.keccak256(dataBuffer);
    return {
      rootHash,
      txHash: '0x' + '0'.repeat(64),
      size: dataBuffer.length,
    };
  }
}

// ─── Download ──────────────────────────────────────────────────────────────────
export async function downloadFromZeroGStorage(rootHash: string): Promise<string | null> {
  if (!PRIVATE_KEY) {
    console.warn('[0G Storage] BACKEND_PRIVATE_KEY not set — cannot download from 0G Storage.');
    return null;
  }

  try {
    const provider = new ethers.JsonRpcProvider(ZERO_G_RPC);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const indexer = new Indexer(ZERO_G_STORAGE_INDEXER);

    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpFile = path.join(os.tmpdir(), `0gmind-dl-${Date.now()}.json`);

    const downloadResult = await indexer.download(rootHash, tmpFile, false);
    const downloadErr = Array.isArray(downloadResult) ? downloadResult[1] : downloadResult;
    if (downloadErr !== null) throw new Error(`Download error: ${String(downloadErr)}`);

    const raw = fs.readFileSync(tmpFile, 'utf8');
    fs.unlinkSync(tmpFile);

    const parsed = JSON.parse(raw);
    return parsed.content || raw;
  } catch (error) {
    console.error('[0G Storage] Download failed:', error);
    return null;
  }
}
