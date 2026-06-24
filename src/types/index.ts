export interface StoreContextRequest {
  content: string;
  modelName: string;
  description: string;
  isPublic: boolean;
  walletAddress?: string;
}

export interface StoreContextResponse {
  success: boolean;
  contextId: string;
  txHash?: string;
  message: string;
  metadata: {
    size: number;
    model: string;
    timestamp: number;
    encrypted: boolean;
  };
}

export interface LoadContextRequest {
  contextId: string;
  walletAddress?: string;
}

export interface LoadContextResponse {
  success: boolean;
  content: string;
  metadata: {
    model: string;
    description: string;
    isPublic: boolean;
    createdAt: number;
    owner?: string;
  };
  message: string;
}

export interface ContextMetadata {
  contextId: string;
  model: string;
  description: string;
  isPublic: boolean;
  size: number;
  timestamp: number;
  accessCount: number;
}

export interface ShareContextRequest {
  contextId: string;
  targetAddress: string;
  ownerAddress: string;
}

export interface ZeroGStorageUploadResult {
  rootHash: string;
  txHash: string;
  size: number;
}
