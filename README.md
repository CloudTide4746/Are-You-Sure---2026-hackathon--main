# MindBridge — 用对话补全你的项目脑图

把模糊的想法变成清晰的项目地图。说几句、或拖入一份项目书，AI 帮你理清「这件事到底是什么」，再生成一张可逐项回答的脑图；答完后一键融合成完整方案文档。

---

## 你能用它做什么

- **先聊清「项目本质」**：不用一上来就填受众、场景，AI 只问能区分方向的一两个问题（比如：是智能交互型还是材料科技型），聊清楚再进脑图。
- **导入现有文档**：支持拖拽或上传 `.txt`、`.pdf`、`.docx` 项目书，自动解析为项目构想并开始分析。
- **脑图工作台**：根据你的构想生成关键问题节点，你逐项作答；可追问、可加 Tips，进度一目了然。
- **一键融合**：全部答完后，将构想与问答整合成一篇可读的项目文档。

适合个人或小团队在立项、写 BP、梳理产品思路时，快速把「脑子里那团东西」结构化。

---

## 快速开始（三步）

### 1. 安装依赖

在项目文件夹里打开终端，执行：

```bash
pip install -r requirements.txt
```

建议先建个虚拟环境（可选）：

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt
```

### 2. 启动服务

```bash
uvicorn backend.main:app --reload
```

看到 `Uvicorn running on http://127.0.0.1:8000` 就表示启动成功。

### 3. 打开页面

用浏览器访问：**http://localhost:8000**

- 在首页输入你的项目想法，或把项目书文件拖进上传区；
- 按提示对话或直接进入脑图，逐个回答节点上的问题；
- 全部完成后点击「融合项目成果」查看生成的文档。

---

## 使用自己的 AI 接口（可选）

不配置时，脑图结构会按内置规则生成，不调用任何大模型。若希望 AI 参与「澄清本质、生成问题、判定回答是否完善、润色融合文档」，可自带 API Key（支持所有 OpenAI 兼容接口）。

1. 在项目根目录复制环境变量示例并改名：

   ```bash
   copy .env.example .env   # Windows
   # cp .env.example .env   # macOS / Linux
   ```

2. 编辑 `.env`，填入你的接口地址和 Key，例如：

   ```env
   AI_API_BASE=https://api.openai.com/v1
   AI_API_KEY=sk-你的key
   AI_MODEL=gpt-4o-mini
   ```

   国内可用 StepFun、DeepSeek、通义等，只要提供 OpenAI 兼容的 `chat/completions` 即可。

3. 保存后重启一次上面的 `uvicorn` 命令，刷新页面即可生效。

---

## 常见问题

- **页面提示连不上后端**：请先确认已执行 `uvicorn backend.main:app --reload`，并且浏览器能访问 http://localhost:8000/health（应返回 `{"status":"ok"}`）。
- **配置了 Key 但没反应**：检查 `.env` 是否在项目根目录、变量名是否与 `.env.example` 一致，修改后需重启 uvicorn。
- **想换端口**：执行 `uvicorn backend.main:app --reload --port 8080`，然后访问 http://localhost:8080。

---

感谢使用。若你有想法或问题，欢迎提 Issue 或直接联系我。
