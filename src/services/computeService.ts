// Read lazily so dotenv.config() (called in index.ts) is always applied first
const getComputeUrl = () => process.env.ZERO_G_COMPUTE_BASE_URL || 'https://router-api.0g.ai/v1';
const getComputeKey = () => process.env.ZERO_G_COMPUTE_API_KEY || '';
const getComputeModel = () => process.env.ZERO_G_COMPUTE_MODEL || 'glm-5';

// Use fetch directly so 0G-specific extensions like chat_template_kwargs
// are not stripped by the OpenAI SDK's type-checked request builder.
async function zeroGChat(messages: { role: string; content: string }[], maxTokens = 500): Promise<string> {
  const key = getComputeKey();
  if (!key) {
    console.warn('[0G Compute] ZERO_G_COMPUTE_API_KEY not set — inference calls will fail. Get a key at pc.0g.ai');
    throw new Error('missing api key');
  }

  const body = {
    model: getComputeModel(),
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },
  };

  const res = await fetch(`${getComputeUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`0G Compute HTTP ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    choices?: { message?: { content?: string | null; reasoning_content?: string } }[];
  };
  const msg = data.choices?.[0]?.message;
  // glm-5 thinking mode puts the answer in content; fallback to reasoning_content if present
  const content = msg?.content || msg?.reasoning_content;
  if (!content) {
    console.error('[0G Compute] unexpected response shape:', JSON.stringify(data).slice(0, 300));
    throw new Error('empty response from 0G Compute');
  }
  return content;
}

export async function summarizeContext(content: string): Promise<string> {
  try {
    return await zeroGChat(
      [
        {
          role: 'system',
          content:
            'You are a context summarizer. Given an AI agent conversation, produce a concise 2-3 sentence summary of the key information and topics covered. Keep it under 60 words.',
        },
        {
          role: 'user',
          content: `Summarize this AI context:\n\n${content.slice(0, 4000)}`,
        },
      ],
      150
    );
  } catch (error) {
    console.error('[0G Compute] summarize error:', error);
    const words = content.split(' ').slice(0, 20).join(' ');
    return `Context: ${words}...`;
  }
}

export async function processContextForAgent(contextContent: string, userQuery: string): Promise<string> {
  try {
    return await zeroGChat([
      {
        role: 'system',
        content: `You are an AI agent with access to the following stored context from 0G Storage:\n\n${contextContent}\n\nUse this context to answer the user's query accurately and concisely.`,
      },
      {
        role: 'user',
        content: userQuery,
      },
    ]);
  } catch (error) {
    console.error('[0G Compute] inference error:', error);
    return localContextSearch(contextContent, userQuery);
  }
}

// Keyword-match fallback when 0G Compute key is missing or unreachable.
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
