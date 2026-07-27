# Simple static file server for testing the Plantel PWA on your phone.
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1
# Then on your phone (same Wi-Fi), open one of the addresses it prints.
# Uses a raw TCP listener (not HttpListener) so it does NOT require Administrator rights.

param(
  [int]$Port = 8080
)

$root = $PSScriptRoot
$mime = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css'; '.js'='application/javascript';
  '.json'='application/json'; '.webmanifest'='application/manifest+json';
  '.png'='image/png'; '.jpeg'='image/jpeg'; '.jpg'='image/jpeg'; '.ico'='image/x-icon';
}

Add-Type -AssemblyName System.Net
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
try {
  $listener.Start()
} catch {
  Write-Host "Nao foi possivel abrir a porta $Port. Tente outra com -Port 8081, ou verifique se ja ha um servidor rodando." -ForegroundColor Red
  exit 1
}

$ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
  Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -ExpandProperty IPAddressToString
Write-Host "Servindo: $root"
Write-Host "Abra no celular (mesma rede Wi-Fi):"
foreach($ip in $ips){ Write-Host "  http://$ip`:$Port" -ForegroundColor Green }
Write-Host "No proprio PC: http://localhost:$Port"
Write-Host "Ctrl+C para parar."
Write-Host ""

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $buffer = New-Object byte[] 8192
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $reqText = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    $firstLine = ($reqText -split "`r`n")[0]
    $parts = $firstLine -split ' '
    $path = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    $path = $path -split '\?' | Select-Object -First 1
    if ($path -eq '/') { $path = '/index.html' }
    $path = [System.Uri]::UnescapeDataString($path)
    $filePath = Join-Path $root ($path.TrimStart('/'))

    if ((Test-Path $filePath -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($bytes, 0, $bytes.Length)
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    }
    $stream.Flush()
  } catch {
  } finally {
    $client.Close()
  }
}
