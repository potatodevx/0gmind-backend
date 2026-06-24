import OpenAI from 'openai';

// Read lazily so dotenv.config() (called in index.ts) is always applied first
const getComputeUrl = () => process.env.ZERO_G_COMPUTE_BASE_URL || 'https://router-api.0g.ai/v1';
const getComputeKey = () => process.env.ZERO_G_COMPUTE_API_KEY || '';
const getComputeModel = () => process.env.ZERO_G_COMPUTE_MODEL || 'glm-5';

// Client is re-created if key changes (e.g. env reload on nodemon restart)
let client: OpenAI | null = null;
let cachedKey = '';

function getClient(): OpenAI {
  const key = getComputeKey();
  if (!key) {
    console.warn('[0G Compute] ZERO_G_COMPUTE_API_KEY not set — inference calls will fail. Get a key at pc.0g.ai');
  }
  if (!client || cachedKey !== key) {
    cachedKey = key;
    client = new OpenAI({
      apiKey: key || 'missing-key',
      baseURL: getComputeUrl(),
    });
  }
  return client;
}

export async function summarizeContext(content: string): Promise<string> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: getComputeModel(),
      messages: [
        {
          role: 'system',
          content:
            'You are a context summarizer. Given an AI agent conversation or context, produce a concise 2-3 sentence summary describing the key information, goals, and state of the context. This summary will be shown as a preview.',
        },
        {
          role: 'user',
          content: `Summarize this AI context:\n\n${content.slice(0, 4000)}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || 'Context stored successfully on 0G.';
  } catch (error) {
    console.error('0G Compute summarize error:', error);
    const words = content.split(' ').slice(0, 20).join(' ');
    return `Context: ${words}...`;
  }
}

export async function processContextForAgent(
  contextContent: string,
  userQuery: string
): Promise<string> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: getComputeModel(),
      messages: [
        {
          role: 'system',
          content: `You are an AI agent with access to the following stored context from 0G Storage:\n\n${contextContent}\n\nUse this context to answer the user's query. The context represents the memory and state of a previous AI session.`,
        },
        {
          role: 'user',
          content: userQuery,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    return (
      response.choices[0]?.message?.content ||
      'I have loaded your context from 0G Storage and am ready to continue.'
    );
  } catch (error) {
    console.error('0G Compute process error:', error);
    // Graceful fallback: scan context for relevant sentences
    return localContextSearch(contextContent, userQuery);
  }
}

// Simple local keyword-match fallback used when 0G Compute key is not yet set.
// Returns relevant lines from the context rather than a generic stub.
function localContextSearch(context: string, query: string): string {
  const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const lines = context.split(/[\n.]+/).map(l => l.trim()).filter(l => l.length > 10);

  const scored = lines.map(line => {
    const lower = line.toLowerCase();
    const hits = queryWords.filter(w => lower.includes(w)).length;
    return { line, hits };
  });

  const relevant = scored.filter(s => s.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 3);

  if (relevant.length > 0) {
    return `Based on the stored context: ${relevant.map(r => r.line).join(' ')}`;
  }
  return `Context loaded from 0G Storage. The context covers: ${context.split(' ').slice(0, 20).join(' ')}...`;
}

export async function validateContext(content: string): Promise<{
  valid: boolean;
  tokenCount: number;
  modelCompatibility: string[];
}> {
  const tokenCount = Math.ceil(content.length / 4);
  const modelCompatibility = [];

  if (tokenCount <= 4096) modelCompatibility.push('gpt-3.5-turbo', 'glm-4', 'claude-haiku');
  if (tokenCount <= 8192) modelCompatibility.push('gpt-4', 'glm-4-plus');
  if (tokenCount <= 32768) modelCompatibility.push('gpt-4-turbo', 'claude-sonnet');
  if (tokenCount <= 128000) modelCompatibility.push('gpt-4o', 'claude-opus', 'glm-5');

  return {
    valid: content.length > 0 && content.length <= 1000000,
    tokenCount,
    modelCompatibility: modelCompatibility.length > 0 ? modelCompatibility : ['glm-5'],
  };
}
