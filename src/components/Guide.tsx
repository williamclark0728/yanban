import clsx from "clsx";
import { useRef } from "react";
import { isDesktop } from "../lib/desktop";

type Item = [string, string];
interface Part {
  id: string;
  title: string;
  /** Where it is on the screen, for the map at the top; omitted for parts that aren't a region. */
  area?: string;
  items: Item[];
  desktop?: boolean;
}

const START: string[] = [
  "设置 → 模型服务：填一家模型服务的 API Key（如 DeepSeek、通义千问）。不填也能先用体验模型试试，每天有次数限制。",
  "左侧点一个智能体开始私聊；想让几个 AI 分工合作，点左上角 ＋ →「从模板新建群聊」。",
  "想让它在你电脑上的文件夹里干活（读写文件、运行脚本、生成报告），用 Windows 桌面版，在右侧详情里打开「工作模式」。",
];

const PARTS: Part[] = [
  {
    id: "sidebar",
    title: "左侧栏",
    area: "对话列表",
    items: [
      ["对话列表", "一个头像是私聊（和一个智能体），几个头像叠在一起是群聊。"],
      ["搜索（放大镜）", "按名字找对话，也能搜历史消息里的内容；点结果跳到那条消息，或把它引用到当前对话。"],
      ["＋ 新建", "新建智能体、新建群聊，或从模板一键建好分工明确的群聊。"],
      ["左下角昵称", "设置你希望 AI 怎么称呼你。"],
      ["齿轮", "打开设置：模型服务、联网搜索、技能、知识库等，也包括本页。"],
    ],
  },
  {
    id: "top",
    title: "顶部栏",
    area: "名字和按钮",
    items: [
      ["中间的名字", "点一下打开右侧详情。"],
      ["右上第一个按钮", "共写文档：在右侧打开这个对话的文档，你和 AI 一起改，可以让 AI 改写选中的段落，也能下载成 Word。"],
      ["右上第二个按钮", "展开或收起右侧详情。"],
    ],
  },
  {
    id: "chat",
    title: "对话区",
    area: "消息",
    items: [
      ["思考过程", "模型回答前的思考，点开查看；英文的思考可以「译成中文」，里面的网址可以点。"],
      ["工具步骤", "回复上方的「搜索…」「阅读…」「运行…」「修改…」是智能体做过的事。带 ⌄ 的点开能看细节：搜索看来源列表，命令看完整命令和输出，改文件看改动对比并可撤销。设置 → 通用 → 工具步骤选「简略」时，多个步骤折成一行，点开再看。"],
      ["来源编号 [1]", "联网回答里的编号对应搜索到的网页。点编号、来源或「阅读」步骤，会先显示完整网址，确认后在浏览器打开，方便核实出处。"],
      ["生成的文件", "回复下方列出这次生成的文件：可以在右侧预览、下载；桌面版还能用默认程序打开、在文件夹中显示。"],
      ["回复下方的按钮", "鼠标移到回复上出现：复制、下载为 Word、放进共写文档、存成技能（把这次的做法保存下来，以后同类任务照着做）。"],
      ["选中回复里的文字", "弹出「引用」（放进输入框接着问）和「讲解」（在右侧单独讲这一段）。"],
      ["建议按钮", "私聊回答下方的两三个后续动作，点一下就发出；设置 → 通用里可以关掉。"],
    ],
  },
  {
    id: "composer",
    title: "输入框",
    area: "输入框",
    items: [
      ["＋", "添加附件：文本、代码、PDF、Word、Excel、PPT、zip 压缩包或图片，也可以直接粘贴。"],
      ["模型", "换这个智能体用的模型。"],
      ["思考强度", "让模型想得多一点或少一点（要模型支持）。"],
      ["计划", "计划模式：智能体先给出方案，你同意后再动手。"],
      ["对比", "选 2–3 个模型同时回答同一个问题，并排比较，挑一份留下。"],
      ["圆环", "上下文用了多少。点开可以手动压缩；快满时发下一条消息前会自动压缩。"],
      ["发送 / 停止", "回复进行中按钮变成停止，也可以按 Esc。"],
      ["输入 / $ @", "/ 用命令（/compact 压缩、/doc 共写文档、/goal 设定目标、/export 导出等）；$ 选技能；@ 指定群成员，或在工作模式下选文件。"],
      ["回复进行中再发", "Enter：插入给正在干活的智能体，它下一步就能看到；Ctrl + Enter：排队，等这条回复完再发。"],
      ["草稿", "没发出去的文字和附件，切到别的对话再回来还在。"],
    ],
  },
  {
    id: "side",
    title: "右侧栏",
    area: "详情",
    items: [
      ["私聊详情", "模型、联网搜索开关、角色设定、工作模式；开发者模式下还能调生成参数（temperature、top_p、max_tokens 等）。"],
      ["群聊详情", "成员、主持人、协作规则、最多轮数、共识规则。"],
      ["也会显示在这里", "文件预览、共写文档、选中文字后的讲解。关掉它们就回到详情。"],
    ],
  },
  {
    id: "group",
    title: "群聊怎么用",
    items: [
      ["直接说任务", "主持人把任务分给成员：有人负责写，有人负责挑问题，按共识规则决定要不要再改一轮。"],
      ["任务看板", "群聊协作时显示每个成员在做什么、做到哪一步。"],
      ["@ 成员", "只让被点名的成员回答。"],
      ["私聊派单", "在私聊里也可以让智能体把任务派到某个群，结果回到群里。"],
    ],
  },
  {
    id: "work",
    title: "工作模式（Windows 桌面版）",
    desktop: true,
    items: [
      ["打开", "右侧详情 →「工作模式」→ 选一个文件夹。智能体只能在这个文件夹里读写文件、运行命令。"],
      ["审批", "设置 → 通用 → 工作模式审批：每次询问、只读自动、智能审批（先由模型判断是否在你的要求范围内）、完全权限。删除等危险命令总要你确认两次。"],
      ["撤销", "改动步骤上的「撤销」，或回复下方的「全部撤销」，把文件改回原样。"],
      ["后台任务", "要跑很久的命令放到后台，输入框上方会出现后台任务条，可以看输出、停止。"],
    ],
  },
  {
    id: "settings",
    title: "设置里的各页",
    items: [
      ["通用", "简洁 / 开发者模式、外观、字号、对话宽度、工具步骤详略、回答后的建议、打开链接前确认。"],
      ["模型服务", "填 API Key，选默认模型。"],
      ["联网搜索", "选博查、Tavily 或自建 SearXNG 并填 Key，智能体才能搜网页。"],
      ["技能", "一套固定的做法说明，导入后在输入框用 $ 调用。"],
      ["MCP", "接入外部工具服务，给智能体更多能力。"],
      ["知识库", "上传论文、讲义等资料，智能体回答时先从里面检索。"],
      ["记忆", "AI 记住的关于你的事，可以查看、删除，或关掉自动记忆。"],
      ["定时任务", "让智能体按时做一件事，比如每天早上搜一下新论文（应用开着时运行）。"],
      ["用量", "各模型用了多少 token。"],
    ],
  },
];

/** A map of the screen at the top, then what each region and button does. */
export function Guide() {
  const box = useRef<HTMLDivElement>(null);
  const jump = (id: string) => box.current?.querySelector(`#guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const area = (id: string, cls: string) => {
    const p = PARTS.find((x) => x.id === id)!;
    const n = PARTS.indexOf(p) + 1;
    return (
      <button
        type="button"
        onClick={() => jump(id)}
        className={clsx("flex flex-col items-center justify-center gap-0.5 rounded-lg border border-line-2 bg-raise text-[12px] text-fg-2 hover:border-accent hover:text-fg", cls)}
      >
        <span className="font-semibold text-fg">
          {n} {p.title}
        </span>
        <span className="text-fg-3">{p.area}</span>
      </button>
    );
  };

  return (
    <div ref={box} className="space-y-6 pt-1">
      <section>
        <h3 className="mb-2 font-semibold">三步上手</h3>
        <ol className="space-y-1.5 text-[13.5px] text-fg-2">
          {START.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent-text">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="mb-1 font-semibold">界面分区</h3>
        <p className="mb-2 text-[13px] text-fg-3">点一块跳到它的说明。</p>
        <div className="grid h-52 grid-cols-[1fr_2.6fr_1.2fr] grid-rows-[auto_1fr_auto] gap-1.5 rounded-xl bg-bg p-1.5">
          {area("sidebar", "row-span-3")}
          {area("top", "py-1.5")}
          {area("side", "row-span-3")}
          {area("chat", "")}
          {area("composer", "py-2")}
        </div>
      </section>

      {PARTS.map((p, i) => (
        <section key={p.id} id={`guide-${p.id}`} className="scroll-mt-2">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-raise-2 text-[12px]">{i + 1}</span>
            {p.title}
            {p.desktop && !isDesktop && <span className="text-[12px] font-normal text-fg-3">网页版没有</span>}
          </h3>
          <dl className="divide-y divide-line rounded-xl border border-line">
            {p.items.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-3.5 py-2.5 text-[13.5px] sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium sm:w-32">{k}</dt>
                <dd className="text-fg-2">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
