from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Draft(SQLModel, table=True):
  """立项那几轮对话 + AI 分析结果"""
  id: Optional[str] = Field(default=None, primary_key=True)
  messages: str = "[]"  # JSON: [{"role":"user"|"system","content":"..."}]
  status: str = "chatting"  # chatting | ready
  mode: str = "detail"  # brief | detail | deep
  max_questions: int = 20  # 总问题配额（不含根节点）
  current_questions: int = 0  # 已生成的问题节点数量
  project_title: Optional[str] = None
  initial_questions: str = "[]"  # JSON: ["q1","q2",...] 仅当 status=ready 时有效
  created_at: datetime = Field(default_factory=datetime.utcnow)
  updated_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectBase(SQLModel):
  name: str
  idea_text: str = ""
  status: str = "in_progress"  # draft / in_progress / completed
  mode: str = "detail"  # brief | detail | deep
  max_questions: int = 20
  current_questions: int = 0


class Project(ProjectBase, table=True):
  id: Optional[str] = Field(default=None, primary_key=True)
  created_at: datetime = Field(default_factory=datetime.utcnow)
  updated_at: datetime = Field(default_factory=datetime.utcnow)


class NodeBase(SQLModel):
  project_id: str = Field(foreign_key="project.id")
  parent_id: Optional[str] = Field(default=None, foreign_key="node.id")
  level: int
  title: str
  question: str
  status: str = "red"  # red / green
  order_index: int = 0
  node_type: str = "question"  # question | tip


class Node(NodeBase, table=True):
  id: Optional[str] = Field(default=None, primary_key=True)


class NodeAnswerBase(SQLModel):
  node_id: str = Field(foreign_key="node.id")
  content: str


class NodeAnswer(NodeAnswerBase, table=True):
  id: Optional[int] = Field(default=None, primary_key=True)
  created_at: datetime = Field(default_factory=datetime.utcnow)


class ProjectDialogBase(SQLModel):
  project_id: str = Field(foreign_key="project.id")
  role: str  # user / system
  content: str


class ProjectDialog(ProjectDialogBase, table=True):
  id: Optional[int] = Field(default=None, primary_key=True)
  created_at: datetime = Field(default_factory=datetime.utcnow)
