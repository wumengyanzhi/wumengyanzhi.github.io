$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskProject 'package.json') -Raw | ConvertFrom-Json).version
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskRelease = Join-Path $taskProject 'artifacts/release'
$taskPackage = Join-Path $taskRelease "五阵破军-v$taskVersion-$taskStamp"
if (-not (Test-Path -LiteralPath (Join-Path $taskProject 'dist/index.html'))) { throw '请先运行 npm run build。' }
New-Item -ItemType Directory -Path $taskPackage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskProject 'dist') -Destination $taskPackage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskProject 'scripts/release-server.mjs') -Destination (Join-Path $taskPackage 'server.mjs') -Force
@'
@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.mjs
if errorlevel 1 pause
'@ | Set-Content -LiteralPath (Join-Path $taskPackage '启动游戏.cmd') -Encoding ascii
@"
五阵破军 · 神话三国 v$taskVersion

完整解压后双击“启动游戏.cmd”，浏览器将打开 http://127.0.0.1:5180。
需要电脑已安装 Node.js 20.19 或更高版本；不需要安装任何 npm 依赖，也不需要联网。
请保留启动窗口，关闭后游戏服务停止；重新双击可继续。
进度保存在当前浏览器，可在设置导出备份。

三套起手、60战斗卡、9锦囊（Ⅰ/Ⅱ/Ⅲ阶）、三关18局、6军市、图鉴、教程、存档、声音。
普通战无敌人技能，仅每关第六局为Boss；每个非最终胜利可随机三选一强化，2金起重抽、每次加价1金，Boss提供跨关基础增幅与路线锦囊成长。
支持拖动布阵、换位、回手、手牌排序；手机长按查看详情，按住移动拖牌，横滑看牌。
操作与设置可调灵敏度、长按速度、吸附、预排伤害和双击操作。
三种卡牌类型用底色与图标区分，四档稀有度用边框与文字标记；电脑连续悬停 1.5 秒查看详情。
姓名旁显示职业，威力与增幅分色完整显示；有技能仅列技能名，无技能不显示该行。
点选人物或兵器时以边框高亮适配牌；实际装备仅在相邻人物间按适配择优，同分优先左侧，以青玉连线显示。
固定战场与手牌托盘；小Logo位于右上，关卡简写1-6，顶部突出敌人与血条。
右侧整合出战资源、技能与锦囊；完整技能及锦囊说明可点击或长按查看，移除常驻操作说明带。
Boss技能战前预告、战中常驻；总览展示职业与兵器加成表、实际配属与加成；布阵上方大号显示威力×增幅=伤害。
醒目敌方血条提供预计削血、残影、伤害飘字与击破反馈，支持关闭动效。
需要决策时直接点牌指定；孙尚香消耗可不发动或取消；布阵留下暗影占位，其他手牌不挪位。
真实结算显示成长、金币与抽牌反馈，奖励页保留最后一手效果。
主菜单“新手演武”提供两场实操教学，包含布阵、配属、选卡、强化与弃牌补牌。
新玩家首次进入可选择新手教程：高亮指定目标，旁边解释，操作后自动进入下一步。
演武进度独立保存，支持退出续练、跳过与重练，不覆盖正式远征。
进度保存在此设备与当前浏览器，可在设置导出备份；不提供跨设备云存档。
网页上线请使用独立“网页发布”包，将 website 文件夹内容上传到静态托管平台。
图片由本次任务内置图像工具生成；声音为原创程序合成。
"@ | Set-Content -LiteralPath (Join-Path $taskPackage '开始之前.txt') -Encoding utf8
$taskZip = "$taskPackage.zip"
Compress-Archive -LiteralPath $taskPackage -DestinationPath $taskZip -Force
Get-Item -LiteralPath $taskZip | Select-Object FullName,Length
