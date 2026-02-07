from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, List, Optional
import os

import httpx


def _env(key: str, default: str = "") -> str:
  return (os.getenv(key) or "").strip() or default


@dataclass
class NodeDraft:
  level: int
  title: str
  question: str
  parent_index: Optional[int]  # index in list, None for root


class AIClient:
  """
  我这边用 OpenAI 兼容接口调大模型；没配 key 就用内置 stub 规则。
  """

  def __init__(self) -> None:
    self.base = _env("AI_API_BASE").rstrip("/")
    self.key = _env("AI_API_KEY")
    self.model = _env("AI_MODEL") or "gpt-4o-mini"
    self.has_real_api = bool(self.base and self.key)

  async def _call_llm(self, messages: List[dict]) -> str:
    url = f"{self.base}/chat/completions"
    payload = {"model": self.model, "messages": messages}
    async with httpx.AsyncClient(timeout=60.0) as client:
      r = await client.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
      )
      r.raise_for_status()
      data = r.json()
      return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""

  async def generate_mindmap(self, idea_text: str) -> List[NodeDraft]:
    if not self.has_real_api:
      return self._generate_stub_mindmap(idea_text)
    try:
      prompt = f"""根据以下项目构想，生成一个3层思维导图节点列表。
要求：
- 输出一个 JSON 数组，每个元素为 {{ "level": 0或1或2或3, "title": "节点标题", "question": "该节点的问题", "parent_index": null或父节点在数组中的下标 }}。
- level=0 的根节点只有1个，title 为项目名，parent_index=null。
- 然后 4 个 level=1 的节点，parent_index=0。
- 每个 1 级节点下 2 个 2 级节点；每个 2 级节点下 2 个 3 级节点。节点总数在 8～28 之间。
- 只输出 JSON 数组，不要其他说明文字。

项目构想：
{idea_text[:2000]}"""
      content = await self._call_llm([{"role": "user", "content": prompt}])
      content = re.sub(r"^.*?\[", "[", content)
      content = re.sub(r"\].*$", "]", content)
      raw = json.loads(content)
      drafts: List[NodeDraft] = []
      for i, item in enumerate(raw):
        if not isinstance(item, dict):
          continue
        level = int(item.get("level", 0))
        title = str(item.get("title", "")).strip() or f"节点{i}"
        question = str(item.get("question", "")).strip() or title
        pi = item.get("parent_index")
        parent_index: Optional[int] = int(pi) if pi is not None else None
        if level == 0:
          parent_index = None
        drafts.append(NodeDraft(level=level, title=title, question=question, parent_index=parent_index))
      if len(drafts) >= 8:
        return drafts
    except Exception:
      pass
    return self._generate_stub_mindmap(idea_text)

  async def make_short_title(self, question: str) -> str:
    """基于问题内容，用 AI 生成不超过 7 字的简短标题；无 API 时退回前 7 字。"""
    q = (question or "").strip()
    if not q:
      return "节点"
    if not self.has_real_api:
      return q[:7]
    try:
      prompt = f"""下面是一条项目脑图中的问题，请你基于它的含义，用不超过 7 个汉字起一个简短、概括性的标题。
要求：不要加引号、句号或问号，不要超过 7 个字，尽量是名词或短语。只输出标题本身。

问题：{q[:300]}
标题："""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip()
      title = content.splitlines()[0].strip(" 《》\"'""''").strip()
      if not title:
        return q[:7]
      return title[:7]
    except Exception:
      return q[:7]

  async def judge_node_completeness(self, node_question: str, answer: str) -> bool:
    if not self.has_real_api:
      return len(answer.strip()) >= 20
    try:
      prompt = f"""以下是一个脑图节点的问题和用户的回答。请判断回答是否足够完善（信息充足、无关键缺失）。只回答 YES 或 NO。

问题：{node_question[:500]}

回答：{answer[:1000]}"""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip().upper()
      return "YES" in content or "是" in content
    except Exception:
      return len(answer.strip()) >= 20

  async def merge_project_doc(self, title: str, idea_text: str, qa_sections: List[str]) -> str:
    if not self.has_real_api:
      return self._merge_stub(title, idea_text, qa_sections)
    try:
      full = f"# {title}\n\n## 原始项目构想\n\n{idea_text or '(无)'}\n\n## 节点问答总结\n\n" + "\n".join(qa_sections)
      prompt = f"""请将以下内容整合成一篇完整的项目文档（Markdown）。要求：保持用户原意，可优化表述与结构，不要篡改用户原始内容。直接输出整篇文档。\n\n{full[:8000]}"""
      return (await self._call_llm([{"role": "user", "content": prompt}])).strip() or self._merge_stub(title, idea_text, qa_sections)
    except Exception:
      return self._merge_stub(title, idea_text, qa_sections)

  async def make_tips_candidates(
    self, project_idea: str, node_question: str, latest_answer: str
  ) -> List[str]:
    """
    基于项目主题 + 当前节点问题 + 最新回答，生成 2~3 条 Tips 建议文本。
    返回纯文本列表，每条为一段完整提示语。
    """
    if not self.has_real_api:
      # stub：简单返回几条固定提示
      base = (node_question or "").strip() or "该节点"
      return [
        f"{base} · 可参考一些业界最佳实践。",
        f"{base} · 结合你的目标用户举 1~2 个具体例子。",
        f"{base} · 想一想有哪些潜在风险或约束条件需要事先列出来。",
      ][:3]
    try:
      prompt = f"""项目背景：
{project_idea[:800]}

当前节点问题：
{node_question[:400]}

用户最近一次回答：
{latest_answer[:800]}

请基于以上信息，为这个节点生成 2~3 条「可供用户参考或补充的信息提示」（Tips），用于帮助他完善思路。

要求：
- 每条 Tips 独立成段，避免重复；
- 用自然中文，一条不超过 100 字；
- 不要使用项目符号或编号；
- 直接输出多行文本，每行一条 Tips，不要输出 JSON 或额外解释。
"""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip()
      lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
      # 取前 3 条非空行
      if not lines:
        return [
          "可以先从目标、用户、场景三个角度，各写一两句文字补充说明。",
          "尝试回顾类似项目的经验，整理 1~2 条你认为最关键的成功要素。",
        ]
      return lines[:3]
    except Exception:
      return [
        "可以先从目标、用户、场景三个角度，各写一两句文字补充说明。",
        "尝试回顾类似项目的经验，整理 1~2 条你认为最关键的成功要素。",
      ]

  async def draft_analyze_and_reply(self, messages: List[dict]) -> dict:
    """立项阶段：只澄清「问题本质」，不问受众/细节。本质清晰后返回 ready + 标题；初题留到进脑图时再生成。"""
    if not self.has_real_api:
      return self._draft_stub(messages)
    try:
      conv = "\n".join([f"{m.get('role','')}: {m.get('content','')}" for m in messages])
      prompt = f"""你正在帮助用户澄清一个项目构想的「本质」——即这件事到底是什么、朝哪个方向做。

当前对话记录：
{conv[:3000]}

重要：本阶段只做「界定本质」，不要追问受众是谁、使用场景、目标用户、功能细节等。只问能区分「这件事到底是什么」的 1～2 个问题。

例如：用户说「高科技被子」，你要区分的是——是科幻电影里那种带屏幕、可交互的智能被子，还是在材料/保暖/健康等科技上做文章的被子？而不是问「目标用户是谁」。

请二选一：

A) 若用户描述仍模糊，无法判断项目本质（例如概念有多义、方向不明确），则用一段自然中文回复，只提 1～2 个用于「界定本质」的追问。不要输出 JSON。

B) 若已能明确概括出项目本质（能写出一个清晰的项目标题），则只输出以下 JSON（不要其他文字、不要 markdown）：
{{"ready":true,"title":"项目标题（不超过20字）"}}
不要输出 initial_questions，初题会在进入工作台时另行生成。"""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip()
      content = re.sub(r"^```\w*\n?", "", content).strip()
      content = re.sub(r"\n?```\s*$", "", content).strip()
      if '{"ready":true' in content or '"ready": true' in content:
        j = json.loads(content)
        if j.get("ready") and j.get("title"):
          return {
            "need_more": False,
            "reply": "好的，项目本质已经清晰，可以进入工作台。我会根据我们聊的内容，在工作台里为你生成几个关键疑问供你逐项回答。",
            "title": str(j["title"])[:24],
            "initial_questions": [],  # 初题在 create_project 时由另一套提示词生成
          }
      return {"need_more": True, "reply": content[:2000]}
    except Exception:
      return self._draft_stub(messages)

  def _draft_stub(self, messages: List[dict]) -> dict:
    user_text = " ".join([m.get("content", "") for m in messages if m.get("role") == "user"])
    if len(user_text.strip()) < 20:
      return {
        "need_more": True,
        "reply": "能再用一两句话说明一下你这个想法主要是指哪一类方向吗？例如：更偏智能交互，还是更偏材料/工艺？",
      }
    title = (user_text.strip()[:20] + "…") if len(user_text) > 20 else user_text.strip() or "未命名项目"
    return {
      "need_more": False,
      "reply": "项目本质已清晰，可以进入工作台。",
      "title": title,
      "initial_questions": [],
    }

  async def generate_initial_mindmap_questions(self, idea_text: str, title: str) -> List[str]:
    """进入脑图后专用：根据已澄清的项目本质，生成 2～3 个供工作台使用的关键疑问或可行性质疑（可含受众、场景、风险等）。"""
    if not self.has_real_api:
      return self._initial_mindmap_questions_stub(idea_text, title)
    try:
      prompt = f"""项目标题：{title[:100]}

用户在与我们澄清「项目本质」时的对话摘要或描述：
{idea_text[:2000]}

请针对这个已澄清的项目，生成 2～3 个供工作台使用的关键疑问或可行性质疑。这一阶段可以涉及：目标用户、使用场景、核心功能优先级、可行性风险、与竞品的差异等。每个问题一句话，不要泛泛的模板问法，要针对该项目具体化。

只输出一个 JSON 数组，例如：["问题1", "问题2", "问题3"]，不要其他文字、不要 markdown。"""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip()
      content = re.sub(r"^.*?\[", "[", content)
      content = re.sub(r"\].*$", "]", content)
      arr = json.loads(content)
      if isinstance(arr, list):
        return [str(q)[:200] for q in arr[:3] if str(q).strip()]
      return self._initial_mindmap_questions_stub(idea_text, title)
    except Exception:
      return self._initial_mindmap_questions_stub(idea_text, title)

  def _initial_mindmap_questions_stub(self, idea_text: str, title: str) -> List[str]:
    return [
      "这个项目要解决的核心问题或满足的需求是什么？",
      "你期望的首要用户或使用场景是怎样的？",
      "你认为当前最大的可行性风险或难点是什么？",
    ]

  async def node_answer_judge_and_followups(
    self, project_idea: str, node_question: str, user_answer: str, current_level: int,
  ) -> dict:
    """判定回答是否充分，并生成 1-2 个追问子问题（用于扩展脑图）。"""
    if not self.has_real_api:
      return self._node_followup_stub(node_question, user_answer, current_level)
    try:
      prompt = f"""项目背景：{project_idea[:800]}

当前节点问题：{node_question[:400]}

用户回答：{user_answer[:1000]}

请判断用户回答是否已足够清晰、可据此推进（信息充足、无关键缺失）。然后：
1) 若已足够，只输出：{{"sufficient":true}}
2) 若需深入或存在疑点，输出：{{"sufficient":false,"followup_questions":["追问1","追问2"]}}，最多 2 个追问，每个问句简短。
只输出上述 JSON，不要其他文字。"""
      content = (await self._call_llm([{"role": "user", "content": prompt}])).strip()
      content = re.sub(r"^.*?\{", "{", content)
      content = re.sub(r"\}.*$", "}", content)
      j = json.loads(content)
      sufficient = bool(j.get("sufficient"))
      followups = j.get("followup_questions") or []
      if not isinstance(followups, list):
        followups = []
      followups = [str(q)[:200] for q in followups[:2]]
      return {"sufficient": sufficient, "followup_questions": followups}
    except Exception:
      return self._node_followup_stub(node_question, user_answer, current_level)

  def _node_followup_stub(self, node_question: str, user_answer: str, current_level: int) -> dict:
    sufficient = len(user_answer.strip()) >= 25
    if current_level >= 3 or sufficient:
      return {"sufficient": True, "followup_questions": []}
    return {
      "sufficient": False,
      "followup_questions": [
        "能再具体说明一下吗？",
        "还有哪些约束或前提需要考虑？",
      ][:2],
    }

  # ----------------- Stub 实现 -----------------

  def _generate_stub_mindmap(self, idea_text: str) -> List[NodeDraft]:
    cleaned = idea_text.strip() or "你的项目"
    max_root_len = 24
    project_name = cleaned[:max_root_len] + ("..." if len(cleaned) > max_root_len else "")

    first_level_titles = [
      "目标与价值",
      "核心用户与场景",
      "功能范围与优先级",
      "实施路径与资源",
    ]

    second_level_templates = {
      0: [
        "项目要解决的核心问题是什么？",
        "项目成功的可量化指标是什么？",
      ],
      1: [
        "第一目标用户是谁？",
        "一个典型使用场景是怎样的？",
      ],
      2: [
        "最核心的三大功能分别是什么？",
        "MVP 阶段准备纳入哪些功能？",
      ],
      3: [
        "你已经拥有哪些关键资源？",
        "项目落地的阶段划分是怎样的？",
      ],
    }

    third_level_followups = [
      "请补充关键约束条件或边界假设。",
      "是否有必须满足的体验或合规要求？",
    ]

    drafts: List[NodeDraft] = []
    # root index 0
    drafts.append(NodeDraft(level=0, title=project_name, question="项目根节点", parent_index=None))

    for i, title in enumerate(first_level_titles):
      level1_index = len(drafts)
      drafts.append(
        NodeDraft(
          level=1,
          title=title,
          question=f"围绕「{title}」，请给出你的整体思路。",
          parent_index=0,
        )
      )
      for q in second_level_templates.get(i, []):
        level2_index = len(drafts)
        drafts.append(
          NodeDraft(
            level=2,
            title=f"{title} - 要点 {second_level_templates[i].index(q) + 1}",
            question=q,
            parent_index=level1_index,
          )
        )
        for idx, follow in enumerate(third_level_followups):
          drafts.append(
            NodeDraft(
              level=3,
              title=f"细节 {idx + 1}",
              question=f"{q}\n{follow}",
              parent_index=level2_index,
            )
          )

    return drafts

  def _merge_stub(self, title: str, idea_text: str, qa_sections: List[str]) -> str:
    parts: List[str] = []
    parts.append(f"# {title} - 融合项目文档（Demo）")
    parts.append("")
    parts.append("## 一、原始项目构想")
    parts.append("")
    parts.append(idea_text or "(无)")
    parts.append("")
    parts.append("## 二、脑图节点问答总结")
    parts.extend(qa_sections)
    parts.append("")
    parts.append("## 三、说明")
    parts.append("")
    parts.append(
      "本文档由 Demo 内置规则自动拼接生成，未接入真实大模型；"
      "在正式环境中，可在保持不篡改你原始意图的前提下，使用大模型优化结构与表述。"
    )
    return "\n".join(parts)


