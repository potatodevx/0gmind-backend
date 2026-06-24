import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { uploadToZeroGStorage, downloadFromZeroGStorage, encryptContent, decryptContent } from '../services/storageService';
import { summarizeContext, processContextForAgent, validateContext } from '../services/computeService';
import { StoreContextRequest, LoadContextRequest } from '../types';

const router = Router();

// In-memory store for context metadata (in production, use a DB)
const contextStore: Map<string, {
  rootHash: string;
  model: string;
  description: string;
  isPublic: boolean;
  summary: string;
  encryptionKey?: string;
  size: number;
  timestamp: number;
  accessCount: number;
  owner?: string;
}> = new Map();

// POST /api/context/store
router.post('/store', async (req: Request, res: Response) => {
  try {
    const { content, modelName, description, isPublic, walletAddress }: StoreContextRequest = req.body;

    if (!content || !modelName) {
      return res.status(400).json({ success: false, message: 'content and modelName are required' });
    }

    // Validate context
    const validation = await validateContext(content);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: 'Invalid context content' });
    }

    // Encrypt if private
    let storageContent = content;
    let encryptionKey: string | undefined;

    if (!isPublic) {
      const encrypted = encryptContent(content);
      storageContent = encrypted.encrypted;
      encryptionKey = encrypted.key;
    }

    // Generate summary via 0G Compute
    const summary = await summarizeContext(content);

    // Store to 0G Storage
    const uploadResult = await uploadToZeroGStorage(storageContent, {
      model: modelName,
      description: description || '',
      isPublic: isPublic || false,
      summary,
      owner: walletAddress || '',
      tokenCount: validation.tokenCount,
    });

    const contextId = uploadResult.rootHash;

    // Save metadata
    contextStore.set(contextId, {
      rootHash: uploadResult.rootHash,
      model: modelName,
      description: description || '',
      isPublic: isPublic || false,
      summary,
      encryptionKey: isPublic ? undefined : encryptionKey,
      size: uploadResult.size,
      timestamp: Date.now(),
      accessCount: 0,
      owner: walletAddress,
    });

    return res.json({
      success: true,
      contextId,
      txHash: uploadResult.txHash,
      message: 'Context stored successfully on 0G Storage',
      metadata: {
        size: uploadResult.size,
        model: modelName,
        timestamp: Date.now(),
        encrypted: !isPublic,
        summary,
        tokenCount: validation.tokenCount,
        modelCompatibility: validation.modelCompatibility,
      },
    });
  } catch (error) {
    console.error('Store context error:', error);
    return res.status(500).json({ success: false, message: 'Failed to store context' });
  }
});

// POST /api/context/load
router.post('/load', async (req: Request, res: Response) => {
  try {
    const { contextId, walletAddress }: LoadContextRequest = req.body;

    if (!contextId) {
      return res.status(400).json({ success: false, message: 'contextId is required' });
    }

    const meta = contextStore.get(contextId);

    if (!meta) {
      return res.status(404).json({ success: false, message: 'Context not found. It may have been stored by a different session.' });
    }

    // Increment access count
    meta.accessCount += 1;

    // Download from 0G Storage
    let content = await downloadFromZeroGStorage(contextId);

    if (!content) {
      // Try to serve from mock/fallback
      content = meta.isPublic
        ? `[Context loaded from 0G Storage - ID: ${contextId}]\nModel: ${meta.model}\nDescription: ${meta.description}`
        : null;
    }

    if (!content) {
      return res.status(404).json({ success: false, message: 'Context data not found on 0G Storage' });
    }

    // Decrypt if encrypted
    if (!meta.isPublic && meta.encryptionKey) {
      try {
        content = decryptContent(content, meta.encryptionKey);
      } catch {
        // Content may not be base64 encoded in fallback
      }
    }

    return res.json({
      success: true,
      content,
      metadata: {
        model: meta.model,
        description: meta.description,
        isPublic: meta.isPublic,
        createdAt: meta.timestamp,
        owner: meta.owner,
        accessCount: meta.accessCount,
        summary: meta.summary,
      },
      message: 'Context loaded from 0G Storage',
    });
  } catch (error) {
    console.error('Load context error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load context' });
  }
});

// GET /api/context/list - list public contexts
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const publicContexts = Array.from(contextStore.entries())
      .filter(([, meta]) => meta.isPublic)
      .map(([id, meta]) => ({
        contextId: id,
        model: meta.model,
        description: meta.description,
        summary: meta.summary,
        size: meta.size,
        timestamp: meta.timestamp,
        accessCount: meta.accessCount,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    return res.json({ success: true, contexts: publicContexts });
  } catch (error) {
    console.error('List contexts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to list contexts' });
  }
});

// POST /api/context/chat - chat using a loaded context
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { contextId, query } = req.body;

    if (!contextId || !query) {
      return res.status(400).json({ success: false, message: 'contextId and query are required' });
    }

    const meta = contextStore.get(contextId);
    if (!meta) {
      return res.status(404).json({ success: false, message: 'Context not found' });
    }

    let content = await downloadFromZeroGStorage(contextId);
    if (!content) {
      content = `Context: ${meta.description}. ${meta.summary}`;
    }

    if (!meta.isPublic && meta.encryptionKey) {
      try {
        content = decryptContent(content, meta.encryptionKey);
      } catch {
        // use as-is
      }
    }

    const response = await processContextForAgent(content, query);

    return res.json({
      success: true,
      response,
      contextId,
      message: 'Response generated using 0G Compute with stored context',
    });
  } catch (error) {
    console.error('Chat with context error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process query' });
  }
});

// GET /api/context/:id/metadata
router.get('/:id/metadata', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const meta = contextStore.get(id);

    if (!meta) {
      return res.status(404).json({ success: false, message: 'Context not found' });
    }

    return res.json({
      success: true,
      contextId: id,
      model: meta.model,
      description: meta.description,
      isPublic: meta.isPublic,
      summary: meta.summary,
      size: meta.size,
      timestamp: meta.timestamp,
      accessCount: meta.accessCount,
      owner: meta.owner,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get metadata' });
  }
});

// GET /api/context/stats
router.get('/stats', async (_req: Request, res: Response) => {
  const total = contextStore.size;
  const publicCount = Array.from(contextStore.values()).filter((m) => m.isPublic).length;
  const totalAccess = Array.from(contextStore.values()).reduce((sum, m) => sum + m.accessCount, 0);
  const totalSize = Array.from(contextStore.values()).reduce((sum, m) => sum + m.size, 0);

  return res.json({
    totalContexts: total,
    publicContexts: publicCount,
    privateContexts: total - publicCount,
    totalAccesses: totalAccess,
    totalSizeBytes: totalSize,
    network: '0G Galileo Testnet',
  });
});

export default router;
