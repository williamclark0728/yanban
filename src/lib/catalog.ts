import type { Protocol, Provider } from "../types";

type Preset = Pick<Provider, "id" | "name" | "protocol" | "baseUrl" | "models" | "keyUrl" | "keyless">;

/** Built-in providers. Users only need to paste a key; the rest is editable. */
export const presets: Preset[] = [
  { id: "deepseek", name: "DeepSeek", protocol: "openai-chat", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "bailian", name: "通义千问 · 百炼", protocol: "openai-chat", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-max", "qwen-turbo"], keyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key" },
  { id: "moonshot", name: "Kimi · 月之暗面", protocol: "openai-chat", baseUrl: "https://api.moonshot.cn/v1", models: [], keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  { id: "zhipu", name: "智谱 GLM", protocol: "openai-chat", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: [], keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { id: "doubao", name: "豆包 · 火山方舟", protocol: "openai-chat", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: [], keyUrl: "https://console.volcengine.com/ark" },
  { id: "siliconflow", name: "硅基流动", protocol: "openai-chat", baseUrl: "https://api.siliconflow.cn/v1", models: [], keyUrl: "https://cloud.siliconflow.cn/account/ak" },
  { id: "openai", name: "OpenAI", protocol: "openai-responses", baseUrl: "https://api.openai.com/v1", models: [], keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", models: [], keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Google Gemini", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: [], keyUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", name: "OpenRouter", protocol: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", models: [], keyUrl: "https://openrouter.ai/keys" },
  { id: "nvidia", name: "NVIDIA NIM", protocol: "openai-chat", baseUrl: "https://integrate.api.nvidia.com/v1", models: [], keyUrl: "https://build.nvidia.com/" },
  { id: "ollama", name: "Ollama 本机", protocol: "openai-chat", baseUrl: "http://localhost:11434/v1", models: [], keyless: true },
];

export const protocols: { value: Protocol; label: string; hint: string }[] = [
  { value: "openai-chat", label: "OpenAI Chat Completions", hint: "绝大多数国产模型和中转服务" },
  { value: "openai-responses", label: "OpenAI Responses", hint: "OpenAI 官方新接口" },
  { value: "anthropic", label: "Anthropic Messages", hint: "Claude 系列" },
  { value: "gemini", label: "Google Gemini", hint: "Gemini 系列" },
];

export const fromPreset = (p: Preset): Provider => ({ ...p, apiKey: "", enabled: false, custom: false });
