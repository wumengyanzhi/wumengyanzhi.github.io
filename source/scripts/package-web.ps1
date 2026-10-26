$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskProject 'package.json') -Raw | ConvertFrom-Json).version
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskSource = Join-Path $taskProject 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'index.html'))) { throw '请先运行 npm run build。' }
$taskPackage = Join-Path $taskProject "artifacts/release/网页发布-v$taskVersion-$taskStamp"
$taskWebsite = Join-Path $taskPackage 'website'
New-Item -ItemType Directory -Path $taskWebsite -ErrorAction Stop | Out-Null
Get-ChildItem -LiteralPath $taskSource | Copy-Item -Destination $taskWebsite -Recurse
$taskZip = Join-Path $taskPackage "五阵破军-网页-v$taskVersion.zip"
Compress-Archive -Path (Join-Path $taskWebsite '*') -DestinationPath $taskZip
@"
五阵破军 · 网页发布 v$taskVersion

发布内容：website 文件夹内的全部文件，也可解压同目录的网页 ZIP。
托管根目录应直接包含 index.html、assets、art、audio 等内容。
使用支持 HTTPS 的静态托管空间，入口为网站根目录。
发布者可从项目执行 npm run build 后重新运行 scripts/package-web.ps1。
玩家只需打开网址，无需 Node.js 或安装包。

存档保存在玩家当前浏览器和当前网站地址下。
本机试玩、正式域名及不同浏览器各自保存进度；可通过游戏设置导出、导入迁移。
本版本没有账号、云存档或游玩数据上传服务。
直接双击 index.html 不等同于部署；请通过静态网站服务访问。
本包已生成，尚未上传任何平台。
"@ | Set-Content -LiteralPath (Join-Path $taskPackage '发布说明.txt') -Encoding utf8
Get-Item -LiteralPath $taskZip | Select-Object FullName,Length
