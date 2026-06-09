# 微信书摘 · Chrome 新标签页扩展

每次打开新标签页，展示一条你的微信读书笔记。支持复制、删除笔记，以及按书籍排除。

## 项目结构

```
wechat-notes-newtab/
├── manifest.json          # 扩展清单 (Manifest V3)
├── newtab/
│   ├── index.html         # 新标签页
│   ├── style.css
│   └── app.js
├── settings/
│   ├── index.html         # 设置页 (chrome.runtime.openOptionsPage)
│   ├── style.css
│   └── settings.js
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## 安装

1. 打开 `chrome://extensions`
2. 开启 **开发者模式**（右上角开关）
3. 点击 **加载已解压缩的扩展程序**
4. 选择 `wechat-notes-newtab` 文件夹
5. 打开新标签页即可看到效果

## 数据格式

导入的笔记 JSON 格式如下：

```json
[
  {
    "id": "唯一标识",
    "content": "笔记正文",
    "book": "书名",
    "author": "作者",
    "chapter": "章节",
    "createTime": "2024-01-15"
  }
]
```

### 字段说明

| 字段 | 必需 | 说明 |
|------|:---:|------|
| `id` | ✅ | 唯一标识符，用于去重（时间戳或 UUID） |
| `content` | ✅ | 笔记正文 |
| `book` | ❌ | 书名，用于分组和排除 |
| `author` | ❌ | 作者 |
| `chapter` | ❌ | 章节名 |
| `createTime` | ❌ | 创建时间 |

> **提示**：从微信读书导出的笔记通常包含 `bookName`、`text` 等字段，可以通过脚本转换为上述格式再导入。扩展默认使用 `book` 字段，若你的数据使用 `bookName` 或 `title` 字段，请对应调整。

## 功能

- **随机展示**：每次打开新标签页随机展示一条笔记
- **防重复**：一轮内不会重复展示同一条笔记
- **复制图片**：将笔记卡片渲染成高清图片，复制到剪贴板（方便分享到社交平台）
- **删除**：确认后从本地存储中永久删除（不影响微信读书）
- **排除书籍**：设置页可按书排除，被排除书籍的笔记不会展示
- **一键同步**：设置页输入微信读书 API Key，自动获取所有笔记（无需手动导出 JSON）
- **手动导入**：也支持上传 JSON 文件或直接粘贴（备选方案）
- **快捷键**：
  - `→` / `n` / `空格`：下一条
  - `c`：复制图片
  - `d` / `Delete`：删除
- **实时同步**：删除或排除更改后，已打开的新标签页会自动响应

## 快速开始：一键同步

1. 打开扩展设置页（扩展图标右键 → **选项**）
2. 点击第一步的链接，前往 [微信读书 Skills 页面](https://weread.qq.com/r/weread-skills)
3. 登录后获取你的 `WEREAD_API_KEY`（格式：`wrk-xxxxxxxx`）
4. 将 API Key 粘贴到设置页输入框
5. 点击 **开始同步**，扩展会自动拉取所有笔记

> API Key 仅保存在本地浏览器中，不会上传到任何服务器。

## 权限说明

- `storage`：在本地存储笔记数据和设置
- `clipboardWrite`：允许复制图片到剪贴板
- `https://i.weread.qq.com/*`：调用微信读书官方 API 获取笔记
