import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "../lib/llm";
import { draftSkill, installSkills } from "../lib/skills";
import type { Skill } from "../types";
import { Modal } from "./Editors";
import { SkillForm } from "./Extensions";

/** Turns a finished reply into a skill: the model drafts SKILL.md, the user edits and saves it. */
export function SaveSkill({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Skill | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const c = new AbortController();
    draftSkill(messageId, c.signal)
      .then(setDraft)
      .catch((e) => !c.signal.aborted && setError(describeError(e).message));
    return () => c.abort();
  }, [messageId]);

  return (
    <Modal
      title="存成技能"
      onClose={onClose}
      footer={<span className="text-[13px] text-fg-3">保存后在 设置 → 技能 里管理，所有智能体都能用，也可以在输入框里用 $ 选它</span>}
    >
      {saved ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 size={32} className="text-ok" />
          <div className="font-medium">已保存技能「{saved}」</div>
          <button type="button" onClick={onClose} className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90">
            好的
          </button>
        </div>
      ) : draft ? (
        <SkillForm
          skill={draft}
          onCancel={onClose}
          onSave={(s) => {
            installSkills([s]);
            setSaved(s.name);
          }}
        />
      ) : error ? (
        <div className="rounded-2xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-12 text-fg-2">
          <Loader2 size={18} className="animate-spin" /> 正在根据这次的做法写技能说明…
        </div>
      )}
    </Modal>
  );
}
