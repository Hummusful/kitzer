import worker from './summary-worker.js';

function normalizeWorkersAiResult(result) {
  if (!result || typeof result !== 'object') return result;

  // Older Workers AI text-generation models exposed a top-level `response`.
  // GLM-4.7-Flash uses the OpenAI-compatible `choices[].message.content` shape.
  if (typeof result.response === 'string' && result.response.trim()) return result;
  if (typeof result?.result?.response === 'string' && result.result.response.trim()) return result;

  const content =
    result?.choices?.[0]?.message?.content ??
    result?.choices?.[0]?.text ??
    result?.output_text ??
    '';

  if (typeof content !== 'string' || !content.trim()) return result;
  return { ...result, response: content };
}

export default {
  async fetch(request, env, ctx) {
    if (!env?.AI || typeof env.AI.run !== 'function') {
      return worker.fetch(request, env, ctx);
    }

    const originalAi = env.AI;
    const compatibleAi = {
      async run(...args) {
        const result = await originalAi.run.apply(originalAi, args);
        return normalizeWorkersAiResult(result);
      }
    };

    const compatibleEnv = new Proxy(env, {
      get(target, property, receiver) {
        if (property === 'AI') return compatibleAi;
        return Reflect.get(target, property, receiver);
      }
    });

    return worker.fetch(request, compatibleEnv, ctx);
  }
};
