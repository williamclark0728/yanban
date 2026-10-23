import Dexie, { type Table } from "dexie";
import type { Agent, Group, Message, Provider, Run } from "../types";
import { fromPreset, presets } from "./catalog";
import { seedAgents, seedGroups, seedMessages } from "./seed";

class YanbanDB extends Dexie {
  providers!: Table<Provider, string>;
  agents!: Table<Agent, string>;
  groups!: Table<Group, string>;
  messages!: Table<Message, string>;
  runs!: Table<Run, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

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
  }
}

export const db = new YanbanDB();

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export const setKv = (key: string, value: unknown) => db.kv.put({ key, value });

/** First launch fills in the agents, the example group and the provider catalog. */
export async function ensureSeeded() {
  await db.transaction("rw", [db.providers, db.agents, db.groups, db.messages, db.runs, db.kv], async () => {
    if (!(await getKv("seeded", false))) {
      const { messages, runs } = seedMessages(Date.now());
      await db.agents.bulkPut(seedAgents);
      await db.groups.bulkPut(seedGroups);
      await db.messages.bulkPut(messages);
      await db.runs.bulkPut(runs);
      await setKv("seeded", true);
    }
    // New presets added in later versions show up without touching saved ones.
    const known = new Set(await db.providers.toCollection().primaryKeys());
    await db.providers.bulkAdd(presets.filter((p) => !known.has(p.id)).map(fromPreset));
  });
}
