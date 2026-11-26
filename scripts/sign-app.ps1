# Create Code Signing Certificate if not exists
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*Dharani*" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Creating new Code Signing certificate..."
    $cert = New-SelfSignedCertificate -CertStoreLocation "Cert:\CurrentUser\My" `
        -Subject "CN=Dharani Weighbridge Software, O=Dharani Technologies, C=IN" `
        -KeySpec Signature `
        -KeyUsage DigitalSignature `
        -Type CodeSigningCert `
        -FriendlyName "Dharani Weighbridge Code Signing" `
        -NotAfter (Get-Date).AddYears(5)
}

# Trust certificate in CurrentUser Root & TrustedPublisher
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
$rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$rootStore.Add($cert)
$rootStore.Close()

$pubStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
$pubStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$pubStore.Add($cert)
$pubStore.Close()

Write-Host "Certificate Subject: " $cert.Subject
Write-Host "Certificate Thumbprint: " $cert.Thumbprint

# Sign the portable executable
$portableExe = Resolve-Path "release/Dharani_Weighbridge_Portable_1.0.0.exe" -ErrorAction SilentlyContinue
if ($portableExe) {
    $sig = Set-AuthenticodeSignature -FilePath $portableExe.Path -Certificate $cert
    Write-Host "Portable exe signature status: " $sig.Status " - " $sig.StatusMessage
}

# Sign the unpacked executable
$unpackedExe = Resolve-Path "release/win-unpacked/Dharani Weighbridge System.exe" -ErrorAction SilentlyContinue
if ($unpackedExe) {
    $sig2 = Set-AuthenticodeSignature -FilePath $unpackedExe.Path -Certificate $cert
    Write-Host "Unpacked exe signature status: " $sig2.Status " - " $sig2.StatusMessage
}

# Also sign DLLs in win-unpacked if any
Get-ChildItem "release/win-unpacked/*.dll" | ForEach-Object {
    Set-AuthenticodeSignature -FilePath $_.FullName -Certificate $cert | Out-Null
}
Write-Host "Code signing completed successfully!"
