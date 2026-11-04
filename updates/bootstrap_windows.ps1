# 在 VS Code 或打开地图预览.cmd 中运行；无命令行参数。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'windows-runtime'
$python = Join-Path $runtime 'python.exe'
$url = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
$expected = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'

function Test-Python($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    & $path -c 'import sys, ssl, zipfile, urllib.request; assert sys.version_info >= (3, 9)' 2>$null
    return $LASTEXITCODE -eq 0
}

if (Test-Python $python) { exit 0 }
Write-Host '正在创建本项目独立的 Windows Python 环境…'
$work = Join-Path $root '.runtime-setup'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$archive = Join-Path $work 'python-3.12.10-embed-amd64.zip'
try {
    if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw 'Python 运行时 SHA-256 校验失败'
    }
    $staged = Join-Path $work 'python'
    if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Recurse -Force }
    Expand-Archive -LiteralPath $archive -DestinationPath $staged
    if (-not (Test-Python (Join-Path $staged 'python.exe'))) { throw '下载的 Python 无法启动' }
    if (Test-Path -LiteralPath $runtime) {
        $backup = Join-Path $work 'previous-runtime'
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
        Move-Item -LiteralPath $runtime -Destination $backup
    }
    Move-Item -LiteralPath $staged -Destination $runtime
    if (-not (Test-Python $python)) { throw 'Python 环境创建失败' }
    Write-Host 'Windows Python 环境已就绪。'
    exit 0
} catch {
    Write-Host "环境创建失败：$_" -ForegroundColor Red
    exit 1
}
