# 游戏内置字体

本目录的 WOFF2 为游戏字库子集，分别制作、分别保留原始版权与 SIL Open Font License 1.1。仅修改字符集合、压缩格式与字体命名，不混合两种字体的字形。

- **Pojun Brush**：基于 [Ma Shan Zheng / 马善政](https://github.com/google/fonts/tree/main/ofl/mashanzheng)，用于标题、角色名、技能名与主要操作。许可见 `MaShanZheng-OFL.txt`。
- **Pojun Text**：基于 [LXGW WenKai Lite / 霞鹜文楷轻便版](https://github.com/lxgw/LxgwWenKai-Lite)，用于正文、规则与小字号信息。许可见 `LXGWWenKai-OFL.txt`。

子集字体使用新的 family、full name 和 PostScript 名称，不使用上游保留名称作为修改字体的名称。来源文件校验值、字形数量与缺字检查见 `manifest.json`。

生成脚本为 `scripts/build-game-fonts.py`。缓存中的原字体只用于构建；游戏离线读取本目录中的字体文件，不依赖第三方字体服务。新增游戏汉字后应重新生成子集，未包含的玩家自定义文本由系统中文字体补齐。
