from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional, Tuple
from uuid import uuid4

from sqlmodel import Session, select

from .ai_client import AIClient
from .models import Draft, Node, NodeAnswer, Project, ProjectDialog

logger = logging.getLogger(__name__)


def _uuid() -> str:
  return uuid4().hex


def _short_title(text: str, fallback: str) -> str:
  """从问题里截 2～5 字当节点标题。"""
  t = (text or "").strip()[:5].strip()
  return t if t else fallback


def flatten_nodes(nodes: List[Node], parent_id: Optional[str] = None) -> List[Node]:
  tree: List[Node] = []
  children = [n for n in nodes if n.parent_id == parent_id]
  children.sort(key=lambda n: n.order_index)
  for c in children:
    tree.append(c)
    tree.extend(flatten_nodes(nodes, c.id))
  return tree


def calc_progress(all_nodes: List[Node]) -> Tuple[int, int, int]:
  # 只算普通问题节点，Tips 和根节点不算
  questions = [
    n
    for n in all_nodes
    if getattr(n, "node_type", "question") != "tip" and getattr(n, "level", 0) > 0
  ]
  total = len(questions)
  green = len([n for n in questions if n.status in ("green", "ai")])
  percent = int(round((green / total) * 100)) if total else 0
  return total, green, percent


# Draft 立项对话


def _mode_limits(mode: str) -> Tuple[int, int]:
  """按模式给问题数和深度上限（现在主要靠脑图里手动追问）。"""
  m = (mode or "detail").lower()
  if m == "brief":
    return 10, 2
  if m == "deep":
    return 40, 4
  return 20, 3


def create_draft(session: Session, mode: str = "detail") -> Draft:
  max_q, _ = _mode_limits(mode)
  draft = Draft(
    id=_uuid(),
    messages="[]",
    status="chatting",
    mode=(mode or "detail"),
    max_questions=max_q,
    current_questions=0,
  )
  session.add(draft)
  session.commit()
  session.refresh(draft)
  return draft


async def draft_append_message(
  session: Session,
  draft_id: str,
  user_content: str,
  ai_client: Optional[AIClient] = None,
) -> Tuple[bool, str, Optional[str], Optional[List[str]]]:
  """把用户这条消息塞进对话，调 AI 分析；返回要不要继续问、回复文案、标题、初题。"""
  draft = session.get(Draft, draft_id)
  if not draft:
    raise ValueError("draft_not_found")
  if draft.status == "ready":
    raise ValueError("draft_already_ready")

  ai_client = ai_client or AIClient()
  messages = json.loads(draft.messages) if draft.messages else []
  messages.append({"role": "user", "content": user_content.strip()})

  result = await ai_client.draft_analyze_and_reply(messages)
  reply = result.get("reply", "")
  need_more = result.get("need_more", True)
  title = result.get("title")
  initial_questions = result.get("initial_questions") or []

  messages.append({"role": "assistant", "content": reply})
  draft.messages = json.dumps(messages, ensure_ascii=False)
  if not need_more and title:
    draft.status = "ready"
    draft.project_title = title
    draft.initial_questions = json.dumps(initial_questions, ensure_ascii=False)
  draft.updated_at = datetime.utcnow()
  session.add(draft)
  session.commit()
  return need_more, reply, title, initial_questions


async def create_project_from_draft(
  session: Session,
  draft_id: str,
  ai_client: Optional[AIClient] = None,
) -> Project:
  """Draft 聊清楚后建项目：根节点 + 用「脑图出题」提示词生成 2～3 个初题。"""
  draft = session.get(Draft, draft_id)
  if not draft:
    raise ValueError("draft_not_found")
  if draft.status != "ready" or not draft.project_title:
    raise ValueError("draft_not_ready")

  messages = json.loads(draft.messages) if draft.messages else []
  idea_parts = [m.get("content", "") for m in messages if m.get("role") == "user"]
  idea_text = "\n".join(idea_parts).strip() or draft.project_title

  max_q, _ = _mode_limits(draft.mode)

  project = Project(
    id=_uuid(),
    name=draft.project_title,
    idea_text=idea_text,
    status="in_progress",
    mode=draft.mode or "detail",
    max_questions=max_q,
    current_questions=0,
  )
  session.add(project)
  session.flush()

  for role, text in [(m.get("role"), m.get("content", "")) for m in messages]:
    if role in ("user", "assistant", "system"):
      session.add(ProjectDialog(project_id=project.id, role=role, content=text))

  # 脑图初题由专用提示词生成（受众、场景、风险等），与立项阶段「只澄清本质」分离
  client = ai_client or AIClient()
  questions = await client.generate_initial_mindmap_questions(idea_text, draft.project_title)
  if not questions:
    fallback = json.loads(draft.initial_questions) if draft.initial_questions else []
    questions = [str(q)[:200] for q in (fallback if isinstance(fallback, list) else [])[:3]]
  if not questions:
    questions = ["这个项目要解决的核心问题是什么？", "你期望的首要用户或使用场景是怎样的？"]
  questions = [str(q)[:200] for q in questions[:3]]

  root_id = _uuid()
  root = Node(
    id=root_id,
    project_id=project.id,
    parent_id=None,
    level=0,
    title=draft.project_title,
    question="项目根节点",
    status="red",
    order_index=0,
  )
  session.add(root)
  session.flush()

  for idx, q in enumerate(questions):
    node_id = _uuid()
    session.add(
      Node(
        id=node_id,
        project_id=project.id,
        parent_id=root_id,
        level=1,
        title=_short_title(q, f"问{idx + 1}"),
        question=q,
        status="red",
        order_index=idx + 1,
      )
    )

  # 初始问题计入总配额
  project.current_questions = len(questions)
  session.add(project)

  session.commit()
  session.refresh(project)
  return project


async def create_project_from_idea(
  session: Session,
  idea_text: str,
  dialog: List[Tuple[str, str]],
  ai_client: Optional[AIClient] = None,
) -> Project:
  ai_client = ai_client or AIClient()

  # 提取项目名
  cleaned = idea_text.strip() or "未命名项目"
  max_len = 24
  name = cleaned[:max_len] + ("..." if len(cleaned) > max_len else "")

  project = Project(id=_uuid(), name=name, idea_text=idea_text)
  session.add(project)
  session.flush()

  for role, text in dialog:
    session.add(
      ProjectDialog(
        project_id=project.id,
        role=role,
        content=text,
      )
    )

  try:
    drafts = await ai_client.generate_mindmap(idea_text)
  except Exception as e:
    logger.warning("AI generate_mindmap failed, using stub: %s", e)
    drafts = ai_client._generate_stub_mindmap(idea_text)

  # 将 drafts 转为 Node，并维护 parent_id
  nodes: List[Node] = []
  for idx, d in enumerate(drafts):
    node_id = _uuid()
    parent_id: Optional[str] = None
    if d.parent_index is not None:
      parent_id = nodes[d.parent_index].id
    node = Node(
      id=node_id,
      project_id=project.id,
      parent_id=parent_id,
      level=d.level,
      title=d.title,
      question=d.question,
      status="red",
      order_index=idx,
    )
    nodes.append(node)
    session.add(node)

  session.commit()
  session.refresh(project)
  return project


def get_project_with_nodes(session: Session, project_id: str) -> Tuple[Project, List[Node]]:
  project = session.get(Project, project_id)
  if not project:
    raise ValueError("project_not_found")
  nodes = session.exec(select(Node).where(Node.project_id == project_id)).all()
  return project, nodes


async def answer_node_and_trace(
  session: Session,
  project_id: str,
  node_id: str,
  content: str,
  ai_client: Optional[AIClient] = None,
  by_ai: bool = False,
) -> Tuple[Node, List[Node], Optional[str], List[Node]]:
  """
  保存回答后：
  - 问题节点本身立即标记为完成（人工回答 = green，AI 回答 = ai）；
  - 额外在其下方生成一个“回答支点”子节点，作为后续追问 / Tips 的锚点：
      - 人工回答生成 status=green 的 answer 节点；
      - AI 回答生成 status=ai、node_type="tip" 的 Tips 节点。
  返回 (node, nodes, next_node_id, added_nodes)，added_nodes 中包含新建的回答节点。
  """

  project, nodes = get_project_with_nodes(session, project_id)
  node = session.get(Node, node_id)
  if not node or node.project_id != project.id:
    raise ValueError("node_not_found")

  # 保存本次回答
  answer = NodeAnswer(node_id=node.id, content=content)
  session.add(answer)
  session.flush()

  next_node_id: Optional[str] = None
  added_nodes: List[Node] = []

  # 任意回答后立即标记为完成：人工回答 = 绿色，AI 回答 = 纯蓝
  node.status = "ai" if by_ai else "green"
  session.add(node)
  session.flush()

  # 在该问题节点下方生成一个“回答支点”子节点
  # - 人工回答：answer 类型节点，绿色；
  # - AI 回答：tip 类型节点，蓝色，表示由 AI 补全。
  nodes = session.exec(select(Node).where(Node.project_id == project_id)).all()
  children = [n for n in nodes if n.parent_id == node.id]
  base_order = max([n.order_index for n in children], default=0)

  answer_node_id = _uuid()
  if by_ai:
    new_title = _short_title(content, "AI答")
    answer_node = Node(
      id=answer_node_id,
      project_id=project.id,
      parent_id=node.id,
      level=node.level + 1,
      title=new_title,
      question=content,
      status="ai",
      node_type="tip",
      order_index=base_order + 1,
    )
  else:
    new_title = _short_title(content, "回答")
    answer_node = Node(
      id=answer_node_id,
      project_id=project.id,
      parent_id=node.id,
      level=node.level + 1,
      title=new_title,
      question=content,
      status="green",
      # node_type 使用默认 "question"，作为一个“回答支点”问题节点
      order_index=base_order + 1,
    )

  session.add(answer_node)
  added_nodes.append(answer_node)

  # 重新获取节点列表，溯源下一个红色分支
  nodes = session.exec(select(Node).where(Node.project_id == project_id)).all()
  next_node_id = _auto_trace_next_red_branch(session, nodes, node)

  # 进度与项目状态更新
  nodes = session.exec(select(Node).where(Node.project_id == project_id)).all()
  flat = flatten_nodes(nodes)
  total, green, _ = calc_progress(flat)
  root = next((n for n in flat if n.level == 0), None)
  if root and root.status != "green":
    non_root = [n for n in flat if n.level > 0]
    if non_root and all(n.status == "green" for n in non_root):
      root.status = "green"
      session.add(root)
  if total and total == green:
    project.status = "completed"
    session.add(project)

  session.commit()
  session.refresh(node)
  nodes = session.exec(select(Node).where(Node.project_id == project_id)).all()
  return node, nodes, next_node_id, added_nodes


async def spawn_followup_node(
  session: Session,
  project_id: str,
  node_id: str,
  ai_client: Optional[AIClient] = None,
) -> Node:
  """
  基于“已回答过的节点”，向外拖拽时生成一个新的追问子节点：
  - 取该节点最新一次回答；
  - 调用 node_answer_judge_and_followups，只使用 followup_questions；
  - 取第一个追问生成子节点。
  """
  ai_client = ai_client or AIClient()

  project, nodes = get_project_with_nodes(session, project_id)
  node = session.get(Node, node_id)
  if not node or node.project_id != project.id:
    raise ValueError("node_not_found")

  # 需要至少有一条回答
  latest_answer = session.exec(
    select(NodeAnswer).where(NodeAnswer.node_id == node.id).order_by(NodeAnswer.created_at.desc())
  ).first()
  if not latest_answer:
    raise ValueError("no_answer")

  result = await ai_client.node_answer_judge_and_followups(
    project.idea_text, node.question, latest_answer.content, node.level
  )
  followups = result.get("followup_questions") or []
  if not isinstance(followups, list):
    followups = []
  followups = [str(q)[:200] for q in followups if str(q).strip()]
  if not followups:
    followups = ["能再具体说明或补充一下吗？"]

  q = followups[0]

  # 找到当前节点已有子节点，计算 order_index
  children = [n for n in nodes if n.parent_id == node.id]
  base_order = max([n.order_index for n in children], default=0)

  new_id = _uuid()
  new_node = Node(
    id=new_id,
    project_id=project.id,
    parent_id=node.id,
    level=node.level + 1,
    title=_short_title(q, "新问"),
    question=q,
    status="red",
    order_index=base_order + 1,
  )
  session.add(new_node)

  # 注意：父节点保持其当前完成状态（green/ai），不再因为新增追问而重新变红

  session.commit()
  session.refresh(new_node)
  return new_node


async def spawn_tips_node(
  session: Session,
  project_id: str,
  node_id: str,
  ai_client: Optional[AIClient] = None,
) -> Node:
  """
  基于“已回答过的节点”，生成一个 Tips 子节点（信息节点，不需要作答）。
  初始 question 为「信息待选择」，后续点击时再请求 AI 生成具体 Tips 选项。
  """
  ai_client = ai_client or AIClient()

  project, nodes = get_project_with_nodes(session, project_id)
  node = session.get(Node, node_id)
  if not node or node.project_id != project.id:
    raise ValueError("node_not_found")

  children = [n for n in nodes if n.parent_id == node.id]
  base_order = max([n.order_index for n in children], default=0)

  q = "信息待选择"
  new_id = _uuid()
  new_node = Node(
    id=new_id,
    project_id=project.id,
    parent_id=node.id,
    level=node.level + 1,
    title="信息待选择",
    question=q,
    status="tip",  # 不计入红绿进度，由前端渲染为蓝色
    order_index=base_order + 1,
    node_type="tip",
  )
  session.add(new_node)

  session.commit()
  session.refresh(new_node)
  return new_node


def _auto_trace_next_red_branch(session: Session, nodes: List[Node], leaf: Node) -> Optional[str]:
  # 构建 id -> node 映射
  node_map = {n.id: n for n in nodes}

  cur = leaf
  candidate_next_id: Optional[str] = None

  while cur.parent_id:
    parent = node_map.get(cur.parent_id)
    if not parent:
      break

    # 父节点下是否还有红色兄弟分支
    siblings = [n for n in nodes if n.parent_id == parent.id]
    red_siblings = [s for s in siblings if s.status == "red"]
    if red_siblings:
      first_red_branch = red_siblings[0]
      candidate_next_id = _find_first_red_leaf(nodes, first_red_branch.id)
      if candidate_next_id is None:
        candidate_next_id = first_red_branch.id
      break

    # 父节点全部子节点绿，则父节点自动变绿，继续向上
    if siblings and all(s.status == "green" for s in siblings):
      if parent.status != "green":
        parent.status = "green"
        session.add(parent)
    cur = parent

  # 根节点全绿逻辑在外层进度计算中处理
  return candidate_next_id


def _find_first_red_leaf(nodes: List[Node], start_id: str) -> Optional[str]:
  node_map = {n.id: n for n in nodes}

  def dfs(nid: str) -> Optional[str]:
    n = node_map[nid]
    children = [c for c in nodes if c.parent_id == n.id]
    if not children and n.status == "red":
      return n.id
    for c in children:
      res = dfs(c.id)
      if res:
        return res
    return None

  return dfs(start_id)


