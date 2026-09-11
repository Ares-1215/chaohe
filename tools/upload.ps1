# 將抓取結果 JSON（{action:"upload",token,date,rows}）POST 到 Edge Function chaohe
# 用法：powershell -ExecutionPolicy Bypass -File upload.ps1 -Json C:\path\payload.json
param([Parameter(Mandatory=$true)][string]$Json)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'config.local.json') | ConvertFrom-Json
$body = Get-Content -Raw -Encoding UTF8 $Json
$res = Invoke-RestMethod -Uri $cfg.edge_url -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$res | ConvertTo-Json -Compress
