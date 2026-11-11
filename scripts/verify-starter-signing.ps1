param([Parameter(Mandatory = $true)][string] $Installer, [Parameter(Mandatory = $true)][string] $Publisher)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $Installer
if ($signature.Status -ne 'Valid') { throw 'RELEASE_SIGNATURE_INVALID' }
if ($signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $Publisher) { throw 'RELEASE_PUBLISHER_MISMATCH' }
Write-Output 'STARTER_AUTHENTICODE_VALID'
