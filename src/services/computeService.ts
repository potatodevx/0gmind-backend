import OpenAI from 'openai';

const ZERO_G_COMPUTE_BASE_URL = process.env.ZERO_G_COMPUTE_BASE_URL || 'https://api.0g.ai/v1';
const ZERO_G_COMPUTE_API_KEY = process.env.ZERO_G_COMPUTE_API_KEY || '';
const ZERO_G_COMPUTE_MODEL = process.env.ZERO_G_COMPUTE_MODEL || 'glm-4';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: ZERO_G_COMPUTE_API_KEY || 'placeholder',
      baseURL: ZERO_G_COMPUTE_BASE_URL,
    });
  }
  return client;
}

export async function summarizeContext(content: string): Promise<string> {
  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: ZERO_G_COMPUTE_MODEL,
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
      model: ZERO_G_COMPUTE_MODEL,
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
    return 'Context loaded from 0G Storage. Ready to continue your previous session.';
  }
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
