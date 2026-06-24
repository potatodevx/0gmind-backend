import { ethers } from 'ethers';
import axios from 'axios';
import { ZeroGStorageUploadResult } from '../types';

const ZERO_G_RPC = process.env.ZERO_G_RPC || 'https://evmrpc-testnet.0g.ai';
const ZERO_G_STORAGE_INDEXER = process.env.ZERO_G_STORAGE_INDEXER || 'https://indexer-storage-testnet-standard.0g.ai';
const FLOW_CONTRACT = process.env.FLOW_CONTRACT || '0x22E03a6A89B950F1c82ec5e74F8eCa321a105296';
const PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY || '';

const FLOW_ABI = [
  'function submit(tuple(bytes32 dataRoot, uint256 epochNumber, uint256 quorumRequired, bytes tags, tuple(uint256 startSegmentIndex, uint256 numSegments, bytes32 merkleRoot, bytes32 dataRoot)[] nodes) submission) payable',
  'function getFlow(bytes32 dataRoot) view returns (tuple(uint256 length, uint256 tags))',
];

function encryptContent(content: string): { encrypted: string; key: string } {
  const key = ethers.hexlify(ethers.randomBytes(32));
  const contentBytes = Buffer.from(content, 'utf8');
  const keyBytes = Buffer.from(key.slice(2), 'hex');
  const encrypted = Buffer.alloc(contentBytes.length);
  for (let i = 0; i < contentBytes.length; i++) {
    encrypted[i] = contentBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return {
    encrypted: encrypted.toString('base64'),
    key,
  };
}

function decryptContent(encrypted: string, key: string): string {
  const encryptedBytes = Buffer.from(encrypted, 'base64');
  const keyBytes = Buffer.from(key.slice(2), 'hex');
  const decrypted = Buffer.alloc(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return decrypted.toString('utf8');
}

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
  const dataHash = ethers.keccak256(dataBuffer);

  if (!PRIVATE_KEY) {
    // Mock response for environments without a private key configured
    const mockRootHash = ethers.keccak256(Buffer.from(content + Date.now().toString()));
    return {
      rootHash: mockRootHash,
      txHash: ethers.keccak256(Buffer.from('mock-tx-' + Date.now())),
      size: dataBuffer.length,
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(ZERO_G_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    // Use 0G Storage Node API for upload
    const uploadResponse = await axios.post(
      `${ZERO_G_STORAGE_INDEXER}/upload`,
      {
        data: dataBuffer.toString('base64'),
        tags: '0x',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Wallet-Address': wallet.address,
        },
        timeout: 30000,
      }
    );

    const rootHash = uploadResponse.data?.rootHash || dataHash;

    const flowContract = new ethers.Contract(FLOW_CONTRACT, FLOW_ABI, wallet);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');

    const tx = await flowContract.submit(
      {
        dataRoot: rootHash,
        epochNumber: 0,
        quorumRequired: 1,
        tags: '0x',
        nodes: [],
      },
      {
        value: ethers.parseEther('0.0001'),
        gasPrice,
      }
    );

    const receipt = await tx.wait();

    return {
      rootHash,
      txHash: receipt.hash,
      size: dataBuffer.length,
    };
  } catch (error) {
    console.error('0G Storage upload error:', error);
    // Fallback: compute deterministic hash and return
    const rootHash = ethers.keccak256(dataBuffer);
    return {
      rootHash,
      txHash: '0x' + '0'.repeat(64),
      size: dataBuffer.length,
    };
  }
}

export async function downloadFromZeroGStorage(rootHash: string): Promise<string | null> {
  try {
    const response = await axios.get(
      `${ZERO_G_STORAGE_INDEXER}/file/${rootHash}`,
      { timeout: 30000 }
    );

    if (response.data) {
      const rawData = Buffer.from(response.data, 'base64').toString('utf8');
      const parsed = JSON.parse(rawData);
      return parsed.content || rawData;
    }
    return null;
  } catch (error) {
    console.error('0G Storage download error:', error);
    return null;
  }
}

export { encryptContent, decryptContent };
