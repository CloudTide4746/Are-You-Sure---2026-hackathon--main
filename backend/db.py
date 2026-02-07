from sqlmodel import SQLModel, create_engine, Session
import os


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./mindmap.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
  """建表；会顺带 import models 把表结构注册上。"""
  from . import models  # noqa: F401

  SQLModel.metadata.create_all(engine)


def get_session() -> Session:
  with Session(engine) as session:
    yield session


