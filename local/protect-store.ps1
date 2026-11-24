param([ValidateSet('protect','unprotect')][string]$Mode)
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $value = [Console]::In.ReadToEnd()
  if ($Mode -eq 'protect') {
    $bytes = [Text.Encoding]::UTF8.GetBytes($value)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($protected))
  } else {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
  }
} catch {
  [Console]::Error.WriteLine('Local credential protection failed.')
  exit 1
}
