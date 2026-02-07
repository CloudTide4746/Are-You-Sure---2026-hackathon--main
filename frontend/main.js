// 前端入口：立项对话 + 脑图工作台，请求本地 8000 端口
const API_BASE = "http://localhost:8000";

const state = {
  projectId: null,
  draftId: null,
  title: "New Project",
  nodes: [],
  activeId: null,
  canvas: { x: 0, y: 0 },
  isDragging: false,
  mouse: { x: 0, y: 0 },
  dialog: [],
  nodePositions: {}, // id -> { left, top, width } 用于拖动与连线
  titled: {}, // nodeId -> true 表示已用 AI 起过名
  fetchingTitle: {}, // nodeId -> true 表示正在请求 AI 标题
  draggingNode: null, // 节点拖拽移动
  dragStart: null,
  didDragThisSession: false,
  tipsCandidates: {}, // nodeId -> string[] Tips 候选
  tipsLoading: {}, // nodeId -> true 表示正在加载 Tips 候选
  contextMenu: { visible: false, nodeId: null },
};

// DOM
const topBar = document.getElementById("top-bar");
const projectTitleDisplay = document.getElementById("project-title-display");
const progressText = document.getElementById("progress-text");
const progressFill = document.getElementById("progress-fill");
const mergeBtn = document.getElementById("merge-btn");

const heroSection = document.getElementById("hero-section");
const chatHistory = document.getElementById("chat-history");
const dropZone = document.getElementById("drop-zone");
const dropFileInput = document.getElementById("drop-file-input");
const initialInput = document.getElementById("initial-input");
const startBtn = document.getElementById("start-btn");

const chatView = document.getElementById("chat-view");
const mindmapView = document.getElementById("mindmap-view");
const canvasContainer = document.getElementById("canvas-container");
const canvasInner = document.getElementById("canvas-inner");

const nodePanel = document.getElementById("node-panel");
const activeNodeName = document.getElementById("active-node-name");
const nodeInput = document.getElementById("node-input");
const nodeSubmit = document.getElementById("node-submit");

const questionFloat = document.getElementById("question-float");
const questionFloatTitle = document.getElementById("question-float-title");
const questionFloatText = document.getElementById("question-float-text");
const questionFloatCard = document.getElementById("question-float-card");

const toastEl = document.getElementById("toast");
const toastIcon = document.getElementById("toast-icon");
const toastText = document.getElementById("toast-text");

const resultModal = document.getElementById("result-modal");
const resultContent = document.getElementById("result-content");
const contextMenu = document.getElementById("node-context-menu");
const contextMenuButtons = contextMenu
  ? Array.from(contextMenu.querySelectorAll("button[data-action]"))
  : [];

function setQuestionFloatInteractive(interactive) {
  if (!questionFloatCard) return;
  questionFloatCard.classList.toggle("pointer-events-none", !interactive);
}

function setNodePanelInteractive(interactive) {
  if (!nodePanel) return;
  nodePanel.classList.toggle("pointer-events-none", !interactive);
}

// 脑图区域内一律禁止浏览器右键菜单，避免与节点右键菜单冲突
if (mindmapView) {
  mindmapView.addEventListener("contextmenu", (e) => e.preventDefault());
}

// 全局屏蔽外来点击反应：禁止浏览器/插件右键菜单、系统拖拽、避免误触产生第三方弹窗
// 仅在输入框/可编辑区域内保留系统菜单（便于粘贴等）
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea, [contenteditable=\"true\"]")) return;
  e.preventDefault();
}, true);
document.addEventListener("dragstart", (e) => e.preventDefault(), true);
document.addEventListener("selectstart", (e) => e.preventDefault(), true);

// 工具函数

function openNodeContextMenu(x, y, nodeId) {
  if (!contextMenu) return;
  state.contextMenu.visible = true;
  state.contextMenu.nodeId = nodeId;

  const padding = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = contextMenu.getBoundingClientRect();
  const menuW = rect.width || 200;
  const menuH = rect.height || 140;

  let left = x;
  let top = y;
  if (left + menuW + padding > vw) left = vw - menuW - padding;
  if (top + menuH + padding > vh) top = vh - menuH - padding;

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
  contextMenu.classList.remove("hidden");
}

function closeNodeContextMenu() {
  if (!contextMenu) return;
  state.contextMenu.visible = false;
  state.contextMenu.nodeId = null;
  contextMenu.classList.add("hidden");
}

function showToast(text, type) {
  toastText.innerText = text;
  toastIcon.className = `w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ${
    type === "green" ? "bg-[#34A853]" : type === "red" ? "bg-[#EA4335]" : "bg-[#4285F4]"
  }`;
  toastIcon.innerHTML = `<i class="fas fa-${
    type === "green" ? "check" : type === "red" ? "exclamation" : "info"
  }"></i>`;
  toastEl.classList.remove("translate-x-20", "opacity-0");
  setTimeout(() => toastEl.classList.add("translate-x-20", "opacity-0"), 3000);
}

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = `flex ${
    role === "user" ? "justify-end" : "justify-start"
  } animate-fadeInUp`;
  div.innerHTML = `<div class="${
    role === "user" ? "bg-[#4285F4] text-white" : "glass text-gray-800"
  } px-8 py-5 rounded-[32px] max-w-[80%] font-semibold text-xl shadow-xl">${text}</div>`;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

/** 对话里显示「文件包」气泡（文件名），不把全文贴出来 */
function addFilePackMsg(filename) {
  const safeName = filename || "导入文档";
  const div = document.createElement("div");
  div.className = "flex justify-end animate-fadeInUp";
  div.innerHTML = `
    <div class="bg-[#1a73e8] text-white px-6 py-4 rounded-[24px] max-w-[80%] shadow-xl flex items-center gap-4">
      <div class="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
        <i class="fas fa-file-alt text-lg"></i>
      </div>
      <div class="flex flex-col items-start min-w-0">
        <span class="text-xs font-semibold opacity-80 mb-0.5">导入项目文档</span>
        <span class="text-sm font-bold break-all">${safeName}</span>
      </div>
    </div>
  `;
  chatHistory.appendChild(div);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function apiJson(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (e) {
    throw new Error("NETWORK: 无法连接后端，请确认已执行 uvicorn backend.main:app --reload");
  }
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.detail || (typeof j.detail === "string" ? j.detail : text);
    } catch (_) {}
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.indexOf(",") >= 0 ? dataUrl.split(",")[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 把文件用 Base64 发到 /api/parse-document，拿回 { text } */
async function uploadAndParseDocument(file) {
  const content_base64 = await readFileAsBase64(file);
  const res = await fetch(`${API_BASE}/api/parse-document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, content_base64 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail || res.statusText;
    throw new Error(detail);
  }
  return res.json();
}

/**
 * 文档解析完成：
 * - 不把全文塞进输入框
 * - 显示一个文件气泡
 * - 直接用文档内容作为立项阶段的「项目构想」发送给后端
 */
function handleParsedDocument(text, filename) {
  const idea = (text || "").trim();
  if (!idea) {
    showToast("文档内容为空，无法作为项目构想。", "red");
    return;
  }
  if (dropZone) {
    dropZone.classList.add("drop-zone-hidden");
  }
  // 直接用文档内容启动立项对话，但 UI 中只展示文件包
  startAction(idea, filename || "导入文档");
  showToast("已导入文档，将根据文档内容分析项目。", "green");
}

// 立项阶段：Draft 多轮对话

/**
 * 立项阶段入口：
 * - 若传入 overriddenContent，则用它作为发送给后端的真实内容（例如文档全文）
 * - fileDisplayName 存在时，会以「文件包」形式展示气泡；否则展示普通文本气泡
 */
async function startAction(overriddenContent, fileDisplayName) {
  const raw = overriddenContent != null ? String(overriddenContent) : initialInput.value;
  const val = raw.trim();
  if (!val) return;

  heroSection.classList.add("hero-exit");
  if (fileDisplayName) {
    addFilePackMsg(fileDisplayName);
  } else {
    addMsg("user", val);
  }
  state.dialog.push({ role: "user", text: val });
  if (overriddenContent == null) {
    initialInput.value = "";
  }
  initialInput.disabled = true;

  try {
    if (!state.draftId) {
      const { draft_id } = await apiJson("/api/draft", {
        method: "POST",
        body: JSON.stringify({}), // 模式不再用于约束数量
      });
      state.draftId = draft_id;
    }

    addMsg("system", "正在分析你的项目…");
    const res = await apiJson(`/api/draft/${state.draftId}/message`, {
      method: "POST",
      body: JSON.stringify({ content: val }),
    });

    // 替换“正在分析”为 AI 真实回复
    chatHistory.lastElementChild?.remove();
    addMsg("system", res.reply);

    if (!res.need_more) {
      state.title = res.title || "未命名项目";
      addMsg("system", "正在生成工作台…");
      const project = await apiJson("/api/projects/from-draft", {
        method: "POST",
        body: JSON.stringify({ draft_id: state.draftId }),
      });
      state.projectId = project.id;
      state.nodes = project.nodes;
      state.draftId = null;
      updateProgress(project.progress);
      await switchView();
      buildMap();
      state.nodes.filter((n) => n.level > 0).forEach((n) => ensureNodeTitle(n));
      showToast("进入 AI 引导工作台", "blue");
    } else {
      initialInput.disabled = false;
      initialInput.focus();
    }
  } catch (e) {
    console.error(e);
    initialInput.disabled = false;
    const msg = e && e.message ? e.message : "后端失败";
    const short = msg.startsWith("NETWORK:")
      ? "无法连接后端，请先启动：uvicorn backend.main:app --reload"
      : msg.length > 50
        ? msg.slice(0, 47) + "..."
        : msg;
    showToast(short, "red");
  }
}

function updateProgress(progress) {
  progressFill.style.width = `${progress.percent}%`;
  progressText.innerText = `${progress.percent}%`;

  if (progress.percent === 100) {
    mergeBtn.classList.replace("bg-gray-100", "bg-[#4285F4]");
    mergeBtn.classList.replace("text-gray-300", "text-white");
    mergeBtn.classList.replace("cursor-not-allowed", "cursor-pointer");
    mergeBtn.classList.add("shadow-blue-300", "hover:scale-105");
  }
}

async function switchView() {
  chatView.classList.add("opacity-0", "pointer-events-none");
  return new Promise((resolve) => {
    setTimeout(() => {
      chatView.classList.add("hidden");
      mindmapView.classList.remove("pointer-events-none", "scale-95");
      mindmapView.classList.add("opacity-100");
      topBar.classList.remove("opacity-0", "pointer-events-none", "-translate-y-8");
      projectTitleDisplay.innerText = state.title;
      resolve();
    }, 600);
  });
}

// 脑图渲染：根在中心，子节点往四个方向发散
const LAYOUT = {
  centerX: 2000,
  centerY: 2000,
  radiusLevel1: 380,
  radiusStep: 320,
  // 四个方向的角度（度）：上、左、右、下（y 轴向下，270° = 上）
  directions: [270, 180, 0, 90],
  nodeWidthRoot: 260,
  nodeWidth: 200,
  nodeHeight: 80,
  perpGap: 100, // 同一方向多个子节点时的垂直间距
};

function buildMap() {
  canvasInner.innerHTML = "";
  if (!state.nodes.length) return;

  const nodes = state.nodes;
  const root = nodes.find((n) => n.level === 0);
  if (!root) return;

  const pos = new Map();
  const getChildren = (pid) =>
    nodes.filter((n) => n.parent_id === pid).sort((a, b) => a.order_index - b.order_index);

  const toRad = (deg) => (deg * Math.PI) / 180;
  const cx = LAYOUT.centerX;
  const cy = LAYOUT.centerY;

  // 根节点放在中心
  pos.set(root.id, { x: cx - LAYOUT.nodeWidthRoot / 2, y: cy - LAYOUT.nodeHeight / 2, level: 0, angle: null, width: LAYOUT.nodeWidthRoot });

  const queue = [{ node: root, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift();
    const children = getChildren(node.id);
    const myPos = pos.get(node.id);
    if (!myPos) continue;

    const myCenterX = myPos.x + (myPos.width || LAYOUT.nodeWidth) / 2;
    const myCenterY = myPos.y + LAYOUT.nodeHeight / 2;

    if (depth === 0) {
      // 第一层：向 上、左、右、下 四个方向发散
      const dirs = LAYOUT.directions;
      children.forEach((child, idx) => {
        const angle = dirs[idx % dirs.length];
        const rad = toRad(angle);
        const r = LAYOUT.radiusLevel1;
        const childCenterX = cx + r * Math.cos(rad);
        const childCenterY = cy + r * Math.sin(rad);
        const w = LAYOUT.nodeWidth;
        pos.set(child.id, {
          x: childCenterX - w / 2,
          y: childCenterY - LAYOUT.nodeHeight / 2,
          level: 1,
          angle,
          width: w,
        });
        queue.push({ node: child, depth: 1 });
      });
    } else {
      // 第二层及以下：沿父节点方向继续延伸，多子节点时略垂直于该方向错开
      const angle = myPos.angle != null ? myPos.angle : 0;
      const rad = toRad(angle);
      const r = LAYOUT.radiusStep;
      const perpRad = toRad(angle + 90);
      const n = children.length;
      children.forEach((child, idx) => {
        const perpOffset = (idx - (n - 1) / 2) * LAYOUT.perpGap;
        const childCenterX = myCenterX + r * Math.cos(rad) + perpOffset * Math.cos(perpRad);
        const childCenterY = myCenterY + r * Math.sin(rad) + perpOffset * Math.sin(perpRad);
        const w = LAYOUT.nodeWidth;
        pos.set(child.id, {
          x: childCenterX - w / 2,
          y: childCenterY - LAYOUT.nodeHeight / 2,
          level: node.level + 1,
          angle,
          width: w,
        });
        queue.push({ node: child, depth: depth + 1 });
      });
    }
  }

  // 与已保存的拖动位置合并（保留用户拖过的位置）
  nodes.forEach((n) => {
    const p = pos.get(n.id);
    if (!p) return;
    const w = p.width || LAYOUT.nodeWidth;
    const saved = state.nodePositions[n.id];
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      p.x = saved.left;
      p.y = saved.top;
      if (saved.width) p.width = saved.width;
    }
    state.nodePositions[n.id] = { left: p.x, top: p.y, width: w };
  });

  // 连线层：SVG 曲线，置于最底层（z-index 0）
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "connector-svg";
  svg.setAttribute("width", "4000");
  svg.setAttribute("height", "4000");
  svg.setAttribute("viewBox", "0 0 4000 4000");
  svg.style.cssText = "position:absolute;left:0;top:0;width:4000px;height:4000px;pointer-events:none;z-index:0";
  canvasInner.appendChild(svg);
  renderConnectors(svg, nodes, pos);

  // 节点层：在连线上方（z-index 1），支持左键选中 + 拖拽移动 + 右键菜单
  nodes.forEach((n) => {
    const p = pos.get(n.id);
    if (!p) return;
    const width = p.width || LAYOUT.nodeWidth;
    const div = document.createElement("div");
    div.id = `node-${n.id}`;
    const isTip = n.node_type === "tip" || n.status === "ai";
    div.className = `node absolute p-6 rounded-[28px] font-black text-sm shadow-xl flex items-center justify-center text-center cursor-pointer ${
      isTip ? "node-tip" : (n.status === "red" ? "node-red" : "node-green")
    } ${!isTip && n.status === "red" ? "pulse-node" : ""}`;
    div.style.left = `${p.x}px`;
    div.style.top = `${p.y}px`;
    div.style.width = `${width}px`;
    div.style.minHeight = `${LAYOUT.nodeHeight}px`;
    div.style.zIndex = "1";
    div.innerHTML = getNodeShortTitle(n);
    div.onmousedown = (e) => {
      e.stopPropagation();
      state.draggingNode = n.id;
      state.didDragThisSession = false;
      const currentPos = state.nodePositions[n.id] || { left: p.x, top: p.y };
      state.dragStart = {
        clientX: e.clientX,
        clientY: e.clientY,
        left: currentPos.left,
        top: currentPos.top,
      };
    };
    div.onclick = (e) => {
      // 若本次交互是拖拽移动，就不触发选中
      if (state.didDragThisSession) {
        state.didDragThisSession = false;
        return;
      }
      selectNode(n.id);
    };
    div.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectNode(n.id);
      openNodeContextMenu(e.clientX, e.clientY, n.id);
    };
    canvasInner.appendChild(div);
  });

  syncCanvas();
}

// 根据当前节点位置绘制曲线连线（二次贝塞尔）
function renderConnectors(svgEl, nodes, posMap) {
  if (!svgEl) svgEl = document.getElementById("connector-svg");
  if (!svgEl) return;
  svgEl.innerHTML = "";
  const curveOffset = 80; // 曲线弯曲程度

  nodes.forEach((n) => {
    if (!n.parent_id) return;
    const pPos = posMap.get(n.parent_id);
    const cPos = posMap.get(n.id);
    if (!pPos || !cPos) return;
    const pW = pPos.width || LAYOUT.nodeWidth;
    const cW = cPos.width || LAYOUT.nodeWidth;
    const sx = pPos.x + pW / 2;
    const sy = pPos.y + LAYOUT.nodeHeight / 2;
    const ex = cPos.x + cW / 2;
    const ey = cPos.y + LAYOUT.nodeHeight / 2;
    const dx = ex - sx;
    const dy = ey - sy;
    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = (-dy / len) * curveOffset;
    const perpY = (dx / len) * curveOffset;
    const cx = midX + perpX;
    const cy = midY + perpY;
    const d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    const isTip = n.node_type === "tip" || n.status === "ai";
    const stroke = isTip ? "#1E88E5" : (n.status === "green" ? "#34A853" : "#EA4335");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    svgEl.appendChild(path);
  });
}

// 根据 state.nodePositions 重算连线（拖动时调用）
function updateConnectors() {
  const posMap = new Map();
  state.nodes.forEach((n) => {
    const pos = state.nodePositions[n.id];
    if (pos) {
      const w = pos.width || (n.level === 0 ? LAYOUT.nodeWidthRoot : LAYOUT.nodeWidth);
      posMap.set(n.id, { x: pos.left, y: pos.top, width: w });
    }
  });
  renderConnectors(null, state.nodes, posMap);
}

// 基于已回答节点生成新问题：长按并拖动该节点触发
async function triggerSpawnFromNode(nodeId) {
  if (!state.projectId) return;
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  // 仅允许在“已作答过”的节点上新增追问：如果当前节点没有回答，后端会返回错误
  const pos = state.nodePositions[nodeId];

  try {
    const newNode = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/spawn`,
      { method: "POST" },
    );

    // 刷新项目，获取完整节点树
    try {
      const project = await apiJson(`/api/projects/${state.projectId}`);
      state.nodes = project.nodes;
    } catch (_) {
      state.nodes = state.nodes.concat(newNode);
    }
    buildMap();
    const added = state.nodes.find((n) => n.id === newNode.id);
    if (added) ensureNodeTitle(added);
    showToast("已为该节点生成一个新的追问问题", "blue");
  } catch (e) {
    console.error(e);
    let msg = e && e.message ? e.message : "生成新问题失败";
    if (msg.includes("no_answer")) msg = "请先回答该节点后再点击加号生成新问题";
    showToast(msg, "red");
  }
}

// 基于当前节点生成一个 Tips 信息节点（蓝色，不需要作答，通常用于“已回答”节点的补充）
async function triggerTipsFromNode(nodeId) {
  if (!state.projectId) return;
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  try {
    const newNode = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/tips`,
      { method: "POST" },
    );

    // 刷新项目，获取完整节点树
    try {
      const project = await apiJson(`/api/projects/${state.projectId}`);
      state.nodes = project.nodes;
    } catch (_) {
      state.nodes = state.nodes.concat(newNode);
    }
    buildMap();
    const added = state.nodes.find((n) => n.id === newNode.id);
    if (added) {
      ensureNodeTitle(added);
      // 新建 Tips 后，自动选中该 Tips 节点，并在问题框中直接展示可选内容
      setTimeout(() => selectNode(added.id), 0);
    }
    showToast("已为该节点生成一个 Tips 信息节点", "blue");
  } catch (e) {
    console.error(e);
    let msg = e && e.message ? e.message : "生成 Tips 失败";
    if (msg.includes("no_answer")) msg = "请先回答该节点后再生成 Tips。";
    showToast(msg, "red");
  }
}

// 为 Tips 节点加载 2~3 条候选 Tips 文本
async function loadTipsCandidates(node) {
  if (!state.projectId || !node || node.node_type !== "tip") return;
  state.tipsLoading[node.id] = true;
  renderTipsCandidates(node);
  try {
    const res = await apiJson(
      `/api/projects/${state.projectId}/nodes/${node.id}/tips/candidates`,
      { method: "POST" },
    );
    const candidates = Array.isArray(res && res.candidates)
      ? res.candidates
      : Array.isArray(res)
        ? res
        : [];
    state.tipsCandidates[node.id] = candidates
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  } catch (e) {
    console.error(e);
    showToast("获取 Tips 候选失败", "red");
    state.tipsCandidates[node.id] = [];
  } finally {
    state.tipsLoading[node.id] = false;
    renderTipsCandidates(node);
  }
}

// 在问题详情框中渲染 Tips 候选卡片
function renderTipsCandidates(node) {
  if (!questionFloatText || !node || node.node_type !== "tip") return;
  if (state.activeId !== node.id) return;

  // 容器使用单列大卡片布局，占据下半屏宽度
  questionFloatText.innerHTML = "";
  questionFloatText.className =
    "grid grid-cols-1 gap-4 text-sm leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar pr-1";

  if (state.tipsLoading[node.id]) {
    setQuestionFloatInteractive(false);
    const loading = document.createElement("div");
    loading.className = "col-span-full text-sm text-gray-400";
    loading.textContent = "正在为你生成 Tips…";
    questionFloatText.appendChild(loading);
    return;
  }

  const cands = state.tipsCandidates[node.id] || [];
  if (!cands.length) {
    setQuestionFloatInteractive(false);
    const empty = document.createElement("div");
    empty.className = "col-span-full text-sm text-gray-400";
    empty.textContent = "暂无可用 Tips，请稍后再试。";
    questionFloatText.appendChild(empty);
    return;
  }

  setQuestionFloatInteractive(true);

  cands.forEach((content, idx) => {
    const card = document.createElement("div");
    card.className =
      "px-5 py-4 rounded-2xl bg-white/90 border border-blue-100 text-gray-800 cursor-pointer hover:bg-blue-50 transition-colors flex flex-col gap-2";

    const title = document.createElement("div");
    title.className = "text-xs font-black text-blue-600 uppercase tracking-wider";
    title.textContent = `TIPS ${idx + 1}`;

    const body = document.createElement("div");
    body.className = "text-sm leading-relaxed line-clamp-4";
    body.textContent = content;

    card.appendChild(title);
    card.appendChild(body);

    card.onclick = () => chooseTip(node.id, content);
    questionFloatText.appendChild(card);
  });
}

// 选择一条 Tips 固化到 Tips 节点上
async function chooseTip(nodeId, content) {
  if (!state.projectId) return;
  const trimmed = (content || "").trim();
  if (!trimmed) return;

  try {
    const node = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/tips/choose`,
      {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      },
    );
    const chosenNodeId =
      (node && node.id) ||
      (node && node.node && node.node.id) ||
      (node && node.updatedNode && node.updatedNode.id) ||
      nodeId;

    // 优先从后端刷新整棵树，确保新 Tips 节点或内容立刻可见
    try {
      const project = await apiJson(`/api/projects/${state.projectId}`);
      state.nodes = project.nodes || state.nodes;
    } catch (_) {
      // 退路：仅在本地更新该节点
      const patch = node && node.node ? node.node : node;
      state.nodes = state.nodes.map((n) => (n.id === chosenNodeId ? { ...n, ...patch } : n));
    }

    state.tipsCandidates[nodeId] = [];
    buildMap();

    const updated = state.nodes.find((n) => n.id === chosenNodeId);
    if (updated) {
      ensureNodeTitle(updated);
      // 重新选中，刷新问题详情框为最终内容
      setTimeout(() => selectNode(updated.id), 0);
    }
    showToast("已应用选中的 Tips", "blue");
  } catch (e) {
    console.error(e);
    showToast("应用 Tips 失败", "red");
  }
}

// 为“未回答的问题”生成可选择的候选答案（可作为 Tips 或直接作为回答）
async function generateAnswerCandidatesForQuestion(node) {
  if (!state.projectId || !node) return;
  const nodeId = node.id;

  state.tipsLoading[nodeId] = true;
  setQuestionFloatInteractive(true);
  if (questionFloatText) {
    questionFloatText.className =
      "grid grid-cols-1 gap-4 text-sm leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar pr-1";
    questionFloatText.innerHTML =
      '<div class="col-span-full text-sm text-gray-400">正在为你生成参考答案…</div>';
  }

  try {
    const res = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/tips/candidates`,
      { method: "POST" },
    );
    const candsRaw = Array.isArray(res && res.candidates)
      ? res.candidates
      : Array.isArray(res)
        ? res
        : [];
    const cands = candsRaw.map((item) => String(item || "").trim()).filter(Boolean);
    if (!cands.length) {
      setQuestionFloatInteractive(false);
      if (questionFloatText) {
        questionFloatText.innerHTML =
          '<div class="col-span-full text-sm text-gray-400">暂时没有合适的参考答案，请稍后再试。</div>';
      }
      return;
    }

    if (!questionFloatText) return;
    setQuestionFloatInteractive(true);
    questionFloatText.innerHTML = "";

    cands.forEach((content, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className =
        "p-5 rounded-2xl bg-white/90 border border-blue-100 text-sm text-gray-800 flex flex-col gap-3";

      const titleRow = document.createElement("div");
      titleRow.className = "flex items-center justify-between gap-2";

      const title = document.createElement("div");
      title.className = "text-xs font-black text-blue-600 uppercase tracking-wider";
      title.textContent = `候选答案 ${idx + 1}`;

      const btnRow = document.createElement("div");
      btnRow.className = "flex items-center gap-2";

      const tipBtn = document.createElement("button");
      tipBtn.className =
        "px-3 py-1 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100";
      tipBtn.textContent = "作为 Tips";
      tipBtn.onclick = () => createTipFromQuestion(nodeId, content);

      const answerBtn = document.createElement("button");
      answerBtn.className =
        "px-3 py-1 rounded-full text-[10px] font-semibold bg-[#34A853]/10 text-[#34A853] hover:bg-[#34A853]/20";
      answerBtn.textContent = "直接作回答";
      answerBtn.onclick = () => applyTipAsAnswer(nodeId, content);

      btnRow.appendChild(tipBtn);
      btnRow.appendChild(answerBtn);

      titleRow.appendChild(title);
      titleRow.appendChild(btnRow);

      const textDiv = document.createElement("div");
      textDiv.className = "leading-relaxed text-sm";
      textDiv.textContent = content;

      wrapper.appendChild(titleRow);
      wrapper.appendChild(textDiv);

      questionFloatText.appendChild(wrapper);
    });
  } catch (e) {
    console.error(e);
    setQuestionFloatInteractive(false);
    if (questionFloatText) {
      questionFloatText.innerHTML =
        '<div class="text-sm text-red-500">生成参考答案时出错，请稍后重试。</div>';
    }
  } finally {
    state.tipsLoading[nodeId] = false;
  }
}

// 从问题节点创建一个 Tips 子节点
async function createTipFromQuestion(nodeId, content) {
  if (!state.projectId) return;
  const trimmed = (content || "").trim();
  if (!trimmed) return;

  try {
    const newNode = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/tips`,
      {
        method: "POST",
      },
    );
    const newTipId =
      (newNode && newNode.id) ||
      (newNode && newNode.node && newNode.node.id) ||
      (newNode && newNode.tip && newNode.tip.id);
    if (!newTipId) {
      throw new Error("invalid_tips_node");
    }

    // 后端目前会返回“信息待选择”的 Tip 节点，这里直接调用 chooseTip 固化内容
    await chooseTip(newTipId, trimmed);
  } catch (e) {
    console.error(e);
    showToast("创建 Tips 节点失败", "red");
  }
}

// 将 AI 提示直接作为当前问题的回答（标记为 AI 回答，纯蓝）
async function applyTipAsAnswer(nodeId, content) {
  if (!state.projectId) return;
  const trimmed = (content || "").trim();
  if (!trimmed) return;

  try {
    const res = await apiJson(
      `/api/projects/${state.projectId}/nodes/${nodeId}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ content: trimmed, by_ai: true }),
      },
    );

    // 尝试更新进度与整棵树，保证颜色与新增节点立刻可见
    if (res.projectProgress) {
      updateProgress(res.projectProgress);
    }

    try {
      const project = await apiJson(`/api/projects/${state.projectId}`);
      state.nodes = project.nodes || state.nodes;
    } catch (_) {
      // 退路：仅更新当前节点
      const updatedNode = res.updatedNode || res.node || res;
      if (updatedNode && updatedNode.id) {
        state.nodes = state.nodes.map((n) =>
          n.id === updatedNode.id ? { ...n, ...updatedNode } : n
        );
      }
    }

    buildMap();
    setTimeout(() => selectNode(nodeId), 0);
    showToast("已将 AI 提示作为回答应用到该问题", "blue");
  } catch (e) {
    console.error(e);
    showToast("应用 AI 回答失败", "red");
  }
}

// ---- 右键菜单操作 ----

function handleContextMenuClick(action) {
  const nodeId = state.contextMenu.nodeId;
  if (!nodeId) {
    closeNodeContextMenu();
    return;
  }
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) {
    closeNodeContextMenu();
    return;
  }
  selectNode(nodeId);

  if (action === "answer") {
    // 根节点与已完成的节点不支持作答
    if (node.level === 0) {
      showToast("根节点用于统领整体主题，不需要直接作答。", "blue");
    } else if (node.status === "green" || node.status === "ai") {
      showToast("该节点已完成作答，如需补充请使用 Tips。", "blue");
    } else {
      // 显式进入作答模式
      enterAnswerModeForNode(node);
    }
  } else if (action === "spawn") {
    triggerSpawnFromNode(nodeId);
  } else if (action === "tips") {
    // 右键 Tips：根据是否已回答来决定行为
    if (node.status === "green" || node.status === "ai") {
      // 已回答：生成补充说明的 Tips 子节点
      triggerTipsFromNode(nodeId);
    } else {
      // 未回答：补充说明 / 参考答案候选
      generateAnswerCandidatesForQuestion(node);
    }
  }

  closeNodeContextMenu();
}

// 底部加号按钮已废除，追问与 Tips 功能统一通过右键菜单触发

/** 每个问题的 2～7 字标题：正在请求 AI 时显示「命名中…」，否则用已有标题或问题前 7 字 */
function getNodeShortTitle(node) {
  if (state.fetchingTitle && state.fetchingTitle[node.id]) return "命名中…";
  const t = (node.title || "").trim();
  if (t && !/^疑问\s*\d+$/.test(t) && !/^追问\s*\d+$/.test(t)) return t;
  const q = (node.question || "").trim();
  return q ? q.replace(/[？?。！!，,、\s]+$/, "").slice(0, 7) : (t || "节点");
}

/** 为节点请求 AI 短标题：先显示「命名中…」，返回后更新节点标题与界面 */
async function ensureNodeTitle(node) {
  if (!state.projectId || !node || node.level === 0) return;
  if (state.titled[node.id]) return;
  if (state.fetchingTitle[node.id]) return;

  state.fetchingTitle = state.fetchingTitle || {};
  state.fetchingTitle[node.id] = true;

  const nodeEl = document.getElementById(`node-${node.id}`);
  if (nodeEl) nodeEl.textContent = "命名中…";
  if (questionFloatTitle && state.activeId === node.id) questionFloatTitle.textContent = "命名中…";
  if (activeNodeName && state.activeId === node.id) activeNodeName.innerText = "命名中…";

  const fallback = (node.question || "").trim().replace(/[？?。！!，,、\s]+$/, "").slice(0, 7) || "节点";

  try {
    const res = await apiJson(
      `/api/projects/${state.projectId}/nodes/${node.id}/title`,
      { method: "POST" },
    );
    const newTitle = (res.title || "").trim() || fallback;
    state.nodes = state.nodes.map((n) => (n.id === node.id ? { ...n, title: newTitle } : n));
    state.titled = state.titled || {};
    state.titled[node.id] = true;
    if (document.getElementById(`node-${node.id}`)) document.getElementById(`node-${node.id}`).textContent = newTitle;
    if (questionFloatTitle && state.activeId === node.id) questionFloatTitle.textContent = newTitle;
    if (activeNodeName && state.activeId === node.id) activeNodeName.innerText = newTitle;
  } catch (e) {
    console.error(e);
    if (nodeEl) nodeEl.textContent = fallback;
    if (questionFloatTitle && state.activeId === node.id) questionFloatTitle.textContent = fallback;
    if (activeNodeName && state.activeId === node.id) activeNodeName.innerText = fallback;
  } finally {
    delete state.fetchingTitle[node.id];
  }
}

function selectNode(id) {
  const node = state.nodes.find((n) => n.id === id);
  if (!node) return;
  state.activeId = id;
  document.querySelectorAll(".node").forEach((el) => el.classList.remove("node-active"));
  const el = document.getElementById(`node-${id}`);
  if (el) el.classList.add("node-active");

  const isTip = node.node_type === "tip";

  // 问题详情框在作答框正上方显示
  if (questionFloat && questionFloatTitle && questionFloatText) {
    const shortTitle = getNodeShortTitle(node);
    questionFloatTitle.textContent = shortTitle;
    // 只让内部卡片接收点击，外层容器保持 pointer-events:none，避免挡住画布
    questionFloat.classList.remove("opacity-0", "translate-y-2");
    setQuestionFloatInteractive(false);

    if (isTip && node.question === "信息待选择") {
      // Tips 节点且尚未选择内容：在问题框中展示可点击的 Tips 卡片
      renderTipsCandidates(node);
      if (!state.tipsCandidates[node.id] && !state.tipsLoading[node.id]) {
        loadTipsCandidates(node);
      }
    } else {
      // 普通问题节点或已选定的 Tips：展示完整文本
      questionFloatText.className =
        "text-gray-700 font-medium text-sm leading-relaxed max-h-[50vh] overflow-y-auto custom-scrollbar pr-1";
      questionFloatText.textContent = node.question || "请简要回答。";
    }
  }

  const pos = canvasInner.querySelector(`#node-${id}`);
  if (pos) {
    const rect = pos.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = window.innerWidth / 2 - centerX;
    const dy = window.innerHeight / 2 - centerY;
    state.canvas.x += dx;
    state.canvas.y += dy;
    syncCanvas();
  }

  // 问题节点：选中时触发 AI 起短标题；Tips 节点：仅在生成时已触发
  if (!isTip) {
    ensureNodeTitle(node);
  }
}

// 画布拖拽（空白处拖动）；节点本身可单独拖动
// 使用整个脑图区作为拖拽热点，避免下半区域难以拖动的问题
mindmapView.addEventListener("mousedown", (e) => {
  // 只处理左键
  if (e.button !== 0) return;
  // 点击在节点、作答面板、问题浮层或右键菜单上时，不触发画布拖拽
  if (
    e.target.closest(".node") ||
    e.target.closest("#node-panel") ||
    e.target.closest("#question-float-card") ||
    e.target.closest("#node-context-menu")
  ) {
    return;
  }
  closeNodeContextMenu();
  state.isDragging = true;
  state.mouse = { x: e.clientX, y: e.clientY };
  canvasInner.style.transition = "none";
  // 拖动画布时，自动收起当前问题描述浮窗
  if (questionFloat) {
    questionFloat.classList.add("opacity-0", "translate-y-2");
    setQuestionFloatInteractive(false);
  }
});
window.onmousemove = (e) => {
  // 拖动单个节点：更新位置与连线
  if (state.draggingNode) {
    const id = state.draggingNode;
    const start = state.dragStart;
    if (!start) return;
    const left = start.left + (e.clientX - start.clientX);
    const top = start.top + (e.clientY - start.clientY);
    const pos = state.nodePositions[id];
    if (pos) {
      pos.left = left;
      pos.top = top;
      if (Math.abs(e.clientX - start.clientX) > 2 || Math.abs(e.clientY - start.clientY) > 2) {
        state.didDragThisSession = true;
      }
    }
    const el = document.getElementById(`node-${id}`);
    if (el) {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    updateConnectors();
    return;
  }
  if (!state.isDragging) return;
  if (state.contextMenu.visible) {
    closeNodeContextMenu();
  }
  const dx = e.clientX - state.mouse.x;
  const dy = e.clientY - state.mouse.y;
  state.canvas.x += dx;
  state.canvas.y += dy;
  syncCanvas();
  state.mouse = { x: e.clientX, y: e.clientY };
};
window.onmouseup = () => {
  if (state.draggingNode) {
    state.dragStart = null;
    state.draggingNode = null;
    updateConnectors();
  }
  state.isDragging = false;
  canvasInner.style.transition = "transform 0.6s cubic-bezier(0.2, 0, 0.2, 1)";
};

window.addEventListener("click", (e) => {
  if (!contextMenu || contextMenu.classList.contains("hidden")) return;
  if (!e.target.closest || !e.target.closest("#node-context-menu")) {
    closeNodeContextMenu();
  }
});

// 绑定右键菜单按钮点击事件
if (contextMenuButtons && contextMenuButtons.length) {
  contextMenuButtons.forEach((btn) => {
    const action = btn.getAttribute("data-action");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (action) handleContextMenuClick(action);
    });
  });
}

function syncCanvas() {
  canvasInner.style.transform = `translate(calc(-50% + ${state.canvas.x}px), calc(-50% + ${state.canvas.y}px))`;
}

// ----------- 节点作答 & 调用后端 -----------

async function submitAnswer() {
  const id = state.activeId;
  if (!id || !state.projectId) return;
  const node = state.nodes.find((n) => n.id === id);
  if (!node) return;
  const val = nodeInput.value.trim();
  if (!val) return;

  try {
    const res = await apiJson(
      `/api/projects/${state.projectId}/nodes/${id}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ content: val, by_ai: false }),
      }
    );

    updateProgress(res.projectProgress);
    try {
      const project = await apiJson(`/api/projects/${state.projectId}`);
      state.nodes = project.nodes;
    } catch (_) {
      const updated = res.updatedNode;
      state.nodes = state.nodes.map((n) =>
        n.id === updated.id ? { ...n, status: updated.status } : n
      );
      if (res.addedNodes && res.addedNodes.length) {
        state.nodes = state.nodes.concat(res.addedNodes);
      }
    }
    buildMap();
    showToast("节点补全成功", "green");

    // 回答完成后，自动收起作答框，避免一直占用视野
    if (nodePanel) {
      nodePanel.classList.add("translate-y-32", "opacity-0");
      setNodePanelInteractive(false);
    }
    if (nodeInput) {
      nodeInput.value = "";
    }

    if (res.nextNodeId) {
      const next = state.nodes.find((n) => n.id === res.nextNodeId);
      if (next) setTimeout(() => selectNode(next.id), 600);
    }
  } catch (e) {
    console.error(e);
    showToast("提交解答失败，请检查后端是否运行。", "red");
  }
}

function enterAnswerModeForNode(node) {
  if (!nodePanel || !nodeInput) return;
  nodePanel.classList.remove("translate-y-32", "opacity-0");
  setNodePanelInteractive(true);
  activeNodeName.innerText = getNodeShortTitle(node);
  nodeInput.disabled = false;
  nodeInput.placeholder = "在此输入你的回答…";
  nodeInput.classList.remove("bg-green-50", "cursor-default");
  nodeInput.classList.add("bg-white/40");
  nodeInput.value = "";
  nodeInput.focus();
  if (nodeSubmit) nodeSubmit.classList.remove("hidden");
}

function enterViewModeForNode(node) {
  if (!nodePanel || !nodeInput) return;
  nodePanel.classList.remove("translate-y-32", "opacity-0");
  setNodePanelInteractive(true);
  activeNodeName.innerText = getNodeShortTitle(node);
  nodeInput.value = "";
  nodeInput.disabled = true;
  nodeInput.placeholder = "";
  nodeInput.classList.remove("bg-white/40");
  nodeInput.classList.add("bg-green-50", "cursor-default");
  if (nodeSubmit) nodeSubmit.classList.add("hidden");
}

// ----------- Merge 融合 -----------

async function openModal() {
  if (!state.projectId) return;
  try {
    const res = await apiJson(`/api/projects/${state.projectId}/merge`, {
      method: "POST",
    });
    resultModal.classList.remove("hidden");
    resultContent.innerHTML = `<pre class="whitespace-pre-wrap text-gray-800 text-lg leading-relaxed">${res.content.replace(
      /</g,
      "&lt;"
    )}</pre>`;
  } catch (e) {
    console.error(e);
    showToast("项目尚未全部补全，无法融合。", "red");
  }
}

window.closeModal = function () {
  resultModal.classList.add("hidden");
};

// 事件绑定

startBtn.addEventListener("click", startAction);
initialInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    startAction();
  }
});

nodeSubmit.addEventListener("click", submitAnswer);
nodeInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitAnswer();
  }
});

mergeBtn.addEventListener("click", openModal);

// 文档拖拽上传

const ALLOWED_DOC_TYPES = [".txt", ".pdf", ".docx"];
function isAllowedFile(file) {
  const name = (file.name || "").toLowerCase();
  return ALLOWED_DOC_TYPES.some((ext) => name.endsWith(ext));
}

function processDroppedFile(file) {
  if (!file || !isAllowedFile(file)) {
    showToast("仅支持 .txt、.pdf、.docx 文件", "red");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("文件过大，最大 5MB", "red");
    return;
  }
  uploadAndParseDocument(file)
    .then((res) => {
      if (res.text) handleParsedDocument(res.text, file.name);
      else showToast("未能识别出文本内容", "red");
    })
    .catch((e) => {
      console.error(e);
      showToast(e && e.message ? e.message : "文档解析失败", "red");
    });
}

if (dropZone) {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("border-[#4285F4]", "bg-blue-50/50");
  });
  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("border-[#4285F4]", "bg-blue-50/50");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("border-[#4285F4]", "bg-blue-50/50");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processDroppedFile(file);
  });
}

if (dropFileInput) {
  dropFileInput.addEventListener("change", (e) => {
    const file = e.target && e.target.files && e.target.files[0];
    if (file) processDroppedFile(file);
    e.target.value = "";
  });
}

// 问题数量与深度由用户在脑图里手动追问/Tips 控制

setQuestionFloatInteractive(false);
setNodePanelInteractive(false);
