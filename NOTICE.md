# 来源与许可

Deep-Soul（本仓库）以 MIT 许可发布，见 LICENSE。

## 运行时依赖（不随仓库分发）

| 组件 | 维护方 | 许可 | 关系 |
| --- | --- | --- | --- |
| DeepSeek Harness (DSH) | DeepSeek | MIT | 宿主运行时；通过插件接口调用，不打包、不修改 |
| Python 标准库 | Python Software Foundation | PSF License | 解释器自带 |
| SQLite | SQLite 作者 | Public Domain | 经 Python sqlite3 使用 |

仓库内不包含 DSH、Python、SQLite 的源码或二进制。

## 文档资产

- docs/figures/*.png、docs/Deep-Soul-识海-技术论述.docx 由本仓库脚本生成。
- 图片中的中文字形使用系统安装的文泉驿正黑渲染；仓库不包含字体文件，只包含栅格化后的 PNG。字体的使用遵循其自身许可。
- 技术论述的 DOCX 由脚本直接生成 OOXML，未使用第三方 DOCX 库。

## 未引入的第三方

本仓库没有依赖或打包 Basic Memory、Obsidian、MCP SDK、向量数据库或任何第三方记忆服务；与它们没有代码或数据格式上的耦合。

## 商标

DeepSeek、DeepSeek Harness 等名称归其各自权利人所有，本项目仅作兼容性说明使用。
