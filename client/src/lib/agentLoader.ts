/**
 * Agent file loader — reads docs/agents/*.md frontmatter + body.
 *
 * Agent file format:
 * ---
 * description: Role description
 * mode: primary | subagent
 * model: anthropic/claude-opus-4-6
 * temperature: 0.1
 * tools:
 *   write: true
 *   edit: true
 *   bash: true
 * ---
 * System prompt body (markdown)
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from './db';

export interface AgentConfig {
  description: string;
  mode: 'primary' | 'subagent';
  model: string;
  temperature: number;
  tools: {
    write: boolean;
    edit: boolean;
    bash: boolean;
  };
  systemPrompt: string;
}

/** Parse YAML-like frontmatter from agent .md file */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].trim();
  const meta: Record<string, unknown> = {};

  // Simple YAML parser (handles flat keys and nested tools block)
  let currentParent = '';
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (line.startsWith('  ') && currentParent) {
      // Nested key (e.g., "  write: true" under "tools:")
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      if (!meta[currentParent]) meta[currentParent] = {};
      (meta[currentParent] as Record<string, unknown>)[key.trim()] = parseValue(value);
    } else {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (!value) {
        // Block start (e.g., "tools:")
        currentParent = key;
      } else {
        meta[key] = parseValue(value);
        currentParent = '';
      }
    }
  }

  return { meta, body };
}

function parseValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const num = Number(v);
  if (!isNaN(num) && v !== '') return num;
  return v;
}

/** Convert model string to engine/model pair */
function parseModelString(modelStr: string): { engine: string; model: string } {
  // "anthropic/claude-opus-4-6" → engine: "claude", model: "claude-opus-4-6"
  // "google/gemini-2.5-pro" → engine: "gemini", model: "gemini-2.5-pro"
  const parts = modelStr.split('/');
  const modelName = parts.length > 1 ? parts[1] : parts[0];

  let engine = 'claude';
  if (modelStr.includes('gemini') || modelStr.includes('google')) engine = 'gemini';
  else if (modelStr.includes('codex') || modelStr.includes('openai') || modelStr.includes('gpt')) engine = 'codex';

  return { engine, model: modelName };
}

/** Convert tools config to allowed_tools list for Claude */
export function toolsToAllowedList(tools: AgentConfig['tools']): string[] {
  const allowed: string[] = ['Read', 'Grep', 'Glob']; // Always allowed
  if (tools.bash) allowed.push('Bash');
  if (tools.write) allowed.push('Write');
  if (tools.edit) allowed.push('Edit');
  return allowed;
}

/** Load an agent .md file and parse its config */
export async function loadAgentFile(filePath: string): Promise<AgentConfig | null> {
  if (!isTauriEnv()) return null;
  try {
    const content = await invoke<string>('read_text_file', { path: filePath });
    const { meta, body } = parseFrontmatter(content);

    const tools = (meta.tools as Record<string, boolean>) || {};
    return {
      description: (meta.description as string) || '',
      mode: (meta.mode as 'primary' | 'subagent') || 'subagent',
      model: (meta.model as string) || 'anthropic/claude-sonnet-4-6',
      temperature: (meta.temperature as number) || 0.1,
      tools: {
        write: tools.write ?? true,
        edit: tools.edit ?? true,
        bash: tools.bash ?? true,
      },
      systemPrompt: body,
    };
  } catch {
    return null;
  }
}

/** List available agent files in a directory */
export async function listAgentFiles(_dirPath: string): Promise<string[]> {
  // Use Rust to scan directory
  if (!isTauriEnv()) return [];
  try {
    // Simple approach: read directory listing via Bash
    // In production, this should be a dedicated Rust command
    return [];
  } catch {
    return [];
  }
}

export { parseModelString };
