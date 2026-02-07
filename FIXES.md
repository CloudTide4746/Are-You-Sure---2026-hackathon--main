# MindMap Issues Fixes - 修复说明

## 修复内容概述

本次修复针对黑客松现场演示中暴露的 3 个关键问题：节点交互不稳定、拖拽连线不同步、Tips 功能不稳定。所有修改均在 `frontend/main.js` 中完成。

---

## 1. 节点交互不稳定（问题 3.1）

### 问题描述
- 浮层（`#question-float`、`#node-panel`）可能挡住节点点击
- 用户无法正常选择节点，尤其在底部区域

### 根本原因
浮层容器使用了 `pointer-events: none` 作为默认值，但在某些情况下（如节点选中、面板展开）会移除这个类，导致浮层拦截了节点的点击事件。

### 修复方案

#### 1.1 新增交互控制函数
```javascript
// frontend/main.js:65
function setQuestionFloatInteractive(interactive) {
  if (!questionFloatCard) return;
  questionFloatCard.classList.toggle("pointer-events-none", !interactive);
}

function setNodePanelInteractive(interactive) {
  if (!nodePanel) return;
  nodePanel.classList.toggle("pointer-events-none", !interactive);
}
```

#### 1.2 默认禁用交互，仅在需要时开启
- 页面加载时默认关闭浮层交互（`frontend/main.js:1319`）
- 只有 Tips 卡片或按钮需要点击时才开启交互
- 加载中、无候选、报错时自动关闭交互，避免透明卡片吞点击

#### 1.3 关键修改点
| 位置 | 修改内容 |
|------|---------|
| `frontend/main.js:1007` | 选中节点时默认关闭交互 |
| `frontend/main.js:1067` | 拖动画布时关闭交互 |
| `frontend/main.js:1194` | 进入作答/查看模式时开启面板交互 |
| `frontend/main.js:1319-1320` | 页面加载时初始化状态 |

### 演示验证步骤
1. 打开脑图工作台
2. 点击任意节点，观察浮层不会挡住节点点击
3. 拖动画布，观察浮层自动收起且不阻挡操作
4. 右键点击节点，菜单正常弹出
5. 底部节点可正常点击，不被浮层遮挡

**预期结果**：所有节点均可正常点击选中，浮层只在需要交互时才响应鼠标事件。

---

## 2. 拖拽连线不同步（问题 3.2）

### 问题描述
- 拖拽节点时连线未实时更新
- 脑图视觉体验差，连线错位
- 连续拖拽同一节点时，位置计算可能出现偏差

### 根本原因
1. `state.dragStart` 使用闭包中的初始坐标，没有读取 `state.nodePositions` 的当前值
2. 拖拽过程中 `updateConnectors()` 仅在移动时调用，鼠标释放后没有再次调用确保同步

### 修复方案

#### 2.1 修复拖拽起点坐标
```javascript
// frontend/main.js:467
div.onmousedown = (e) => {
  e.stopPropagation();
  state.draggingNode = n.id;
  state.didDragThisSession = false;
  // 修复：读取当前位置，而不是闭包中的旧坐标
  const currentPos = state.nodePositions[n.id] || { left: p.x, top: p.y };
  state.dragStart = {
    clientX: e.clientX,
    clientY: e.clientY,
    left: currentPos.left,
    top: currentPos.top,
  };
};
```

#### 2.2 确保释放时同步连线
```javascript
// frontend/main.js:1105
window.onmouseup = () => {
  if (state.draggingNode) {
    state.dragStart = null;
    state.draggingNode = null;
    // 修复：确保连线在拖拽结束时更新
    updateConnectors();
  }
  state.isDragging = false;
  canvasInner.style.transition = "transform 0.6s cubic-bezier(0.2, 0, 0.2, 1)";
};
```

### 演示验证步骤
1. 打开脑图，拖拽任意节点
2. 观察连线是否实时跟随节点移动
3. 松开鼠标后，检查连线是否正确连接到节点中心
4. 连续拖拽同一节点两次，确认位置计算没有偏差
5. 拖拽多个节点，观察连线网络是否保持正确连接

**预期结果**：拖拽时连线实时更新，释放后连线准确连接，连续拖拽无偏差。

---

## 3. Tips 功能不稳定（问题 3.3）

### 问题描述
- Tips 候选生成可能失败（接口返回数据结构不一致）
- Tips 选择可能失败（后端返回数据结构不统一）
- 用户无法获取 AI 提示建议

### 根本原因
1. 后端接口返回的数据结构可能变化（如 `res.candidates` 或直接数组）
2. `chooseTip` 和 `createTipFromQuestion` 中提取节点 ID 的逻辑不健壮
3. 没有对空值、null、undefined 进行过滤处理

### 修复方案

#### 3.1 兼容多种候选数据结构
```javascript
// frontend/main.js:627-634
const candidates = Array.isArray(res && res.candidates)
  ? res.candidates
  : Array.isArray(res)
    ? res
    : [];
state.tipsCandidates[node.id] = candidates
  .map((item) => String(item || "").trim())
  .filter(Boolean);
```

#### 3.2 健壮的节点 ID 提取
```javascript
// frontend/main.js:711-715
const chosenNodeId =
  (node && node.id) ||
  (node && node.node && node.node.id) ||
  (node && node.updatedNode && node.updatedNode.id) ||
  nodeId;
```

#### 3.3 创建 Tips 时的错误处理
```javascript
// frontend/main.js:799-813
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
// 后端目前会返回"信息待选择"的 Tip 节点，这里直接调用 chooseTip 固化内容
await chooseTip(newTipId, trimmed);
```

#### 3.4 生成答案候选的兼容处理
```javascript
// frontend/main.js:762-767
const candsRaw = Array.isArray(res && res.candidates)
  ? res.candidates
  : Array.isArray(res)
    ? res
    : [];
const cands = candsRaw.map((item) => String(item || "").trim()).filter(Boolean);
```

### 演示验证步骤
1. 右键点击任意节点，选择"Tips"
2. 观察 Tips 候选是否成功生成并显示
3. 点击任意一条 Tips 卡片，观察是否成功应用
4. 对于未回答的问题，右键选择 Tips，观察是否生成候选答案
5. 点击"作为 Tips"或"直接作回答"按钮，观察功能是否正常

**预期结果**：Tips 候选稳定生成，选择和应用功能正常，候选答案功能可用。

---

## 4. 额外优化

### 4.1 智能交互控制
- 在加载中、无候选、报错时自动关闭浮层交互
- 避免透明卡片继续吞点击事件
- 提升用户体验一致性

### 4.2 代码健壮性增强
- 所有 API 返回值都进行了防御性处理
- 添加了空值过滤和类型转换
- 统一了错误处理逻辑

---

## 5. 技术细节

### 5.1 修改文件清单
| 文件 | 修改内容 | 行数变化 |
|------|---------|---------|
| `frontend/main.js` | 新增交互控制函数、修复拖拽坐标、兼容 Tips 接口 | +100+ 行 |

### 5.2 新增函数
- `setQuestionFloatInteractive(interactive)` - 控制问题浮层交互
- `setNodePanelInteractive(interactive)` - 控制作答面板交互

### 5.3 关键代码片段
```javascript
// 初始化交互状态（页面加载时）
setQuestionFloatInteractive(false);
setNodePanelInteractive(false);

// 拖拽节点时实时更新连线
window.onmousemove = (e) => {
  if (state.draggingNode) {
    // ... 更新节点位置
    updateConnectors(); // 实时更新连线
    return;
  }
};

// 拖拽结束时确保连线同步
window.onmouseup = () => {
  if (state.draggingNode) {
    state.dragStart = null;
    state.draggingNode = null;
    updateConnectors(); // 再次更新确保同步
  }
};
```

---

## 6. 测试建议

### 6.1 单元测试（建议后续补充）
- 测试 `setQuestionFloatInteractive` 函数在各种情况下的行为
- 测试 `loadTipsCandidates` 对不同 API 返回结构的兼容性
- 测试 `chooseTip` 在各种返回结构下的节点 ID 提取

### 6.2 集成测试
- 完整的脑图交互流程测试
- 拖拽节点的连续操作测试
- Tips 功能的端到端测试

### 6.3 性能测试
- 大量节点时的拖拽性能
- 连线更新频率对性能的影响

---

## 7. 后续优化建议

1. **抽取交互控制为独立模块**：将 `setQuestionFloatInteractive` 和 `setNodePanelInteractive` 抽取为独立的交互管理器
2. **添加拖拽防抖**：在高频率拖拽时适当降低 `updateConnectors` 的调用频率
3. **统一 API 返回格式**：与后端协商统一的响应格式，减少前端的兼容性处理
4. **添加错误监控**：将 Tips 相关的错误上报到监控系统
5. **性能优化**：对连线更新进行节流处理，避免不必要的重绘

---

## 8. 演示准备清单

### 8.1 环境准备
- [ ] 确认后端服务运行正常（`uvicorn backend.main:app --reload`）
- [ ] 确认前端页面可访问（`http://localhost:8000`）
- [ ] 准备测试项目数据

### 8.2 功能演示
- [ ] 演示节点点击（验证浮层不阻挡）
- [ ] 演示节点拖拽（验证连线实时更新）
- [ ] 演示 Tips 功能（验证候选生成和选择）
- [ ] 演示候选答案功能（验证"作为 Tips"和"直接作回答"）

### 8.3 边界测试
- [ ] 连续拖拽同一节点多次
- [ ] 快速点击多个节点
- [ ] 在加载中时点击浮层（验证不响应）
- [ ] Tips 候选为空时的处理

---

## 9. 回滚方案

如果本次修复引入新的问题，可以通过以下方式回滚：

```bash
# 方法 1：切换到上一个 commit
git reset --hard HEAD~1

# 方法 2：切换到其他分支
git checkout master  # 或其他稳定分支
```

---

## 10. 联系信息

如有问题，请在 GitHub Issues 中反馈，或直接联系：
- 项目仓库：[GitHub 仓库链接]
- 分支：`fix/mindmap-issues`
- 提交：`00b528a`

---

**修复日期**：2026年2月7日
**修复人员**：AI 助手 Hephaestus
**审核状态**：待审核
**部署状态**：待部署
