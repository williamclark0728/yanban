import Dexie, { type Table } from "dexie";
import type { Agent, Chunk, Group, Message, Provider, Run } from "../types";
import { fromPreset, presets } from "./catalog";
import { seedAgents, seedGroups, seedMessages } from "./seed";

class YanbanDB extends Dexie {
  providers!: Table<Provider, string>;
  agents!: Table<Agent, string>;
  groups!: Table<Group, string>;
  messages!: Table<Message, string>;
  runs!: Table<Run, string>;
  kv!: Table<{ key: string; value: unknown }, string>;
  chunks!: Table<Chunk, string>;

  constructor() {
    super("yanban");
    this.version(1).stores({
      providers: "id",
      agents: "id",
      groups: "id",
      messages: "id, chat, at",
      runs: "id, groupId",
      kv: "key",
    });
    // 0.6.0: knowledge-base passages.
    this.version(2).stores({ chunks: "id, lib, doc" });
  }
}

export const db = new YanbanDB();

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export const setKv = (key: string, value: unknown) => db.kv.put({ key, value });

/**
 * Adds whichever example agents and groups are missing, without touching ones the user changed.
 * A restored group comes back with its example run so its page shows how a collaboration looks.
 */
export async function addExamples() {
  await db.transaction("rw", [db.agents, db.groups, db.messages, db.runs], async () => {
    const agentIds = new Set(await db.agents.toCollection().primaryKeys());
    const groupIds = new Set(await db.groups.toCollection().primaryKeys());
    const groups = seedGroups.filter((g) => !groupIds.has(g.id));
    const { messages, runs } = seedMessages(Date.now());
    await db.agents.bulkAdd(seedAgents.filter((a) => !agentIds.has(a.id)));
    await db.groups.bulkAdd(groups);
    const restored = new Set(groups.map((g) => g.id));
    await db.messages.bulkPut(messages.filter((m) => restored.has(m.chat)));
    await db.runs.bulkPut(runs.filter((r) => restored.has(r.groupId)));
  });
}

/** First launch fills in the example agents and group, and the provider catalog. */
export async function ensureSeeded() {
  if (!(await getKv("seeded", false))) {
    await addExamples();
    await setKv("seeded", true);
  }
  await db.transaction("rw", [db.providers], async () => {
    // New presets added in later versions show up without touching saved ones.
    const known = new Set(await db.providers.toCollection().primaryKeys());
    await db.providers.bulkAdd(presets.filter((p) => !known.has(p.id)).map(fromPreset));
  });
}
