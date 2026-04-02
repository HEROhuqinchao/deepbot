# DeepBot 自签名证书生成脚本
# 用于本地开发和测试，避免 Windows SmartScreen 警告

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "DeepBot 自签名证书生成工具" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 设置证书信息
$certSubject = "CN=DeepBot Terminal, O=DeepBot, C=CN"
$certFriendlyName = "DeepBot Terminal Code Signing"

Write-Host "正在生成自签名证书..." -ForegroundColor Yellow

# 创建自签名代码签名证书
$cert = New-SelfSignedCertificate `
    -Type Custom `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -Subject $certSubject `
    -FriendlyName $certFriendlyName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") `
    -NotAfter (Get-Date).AddYears(2)

Write-Host ""
Write-Host "✅ 证书生成成功！" -ForegroundColor Green
Write-Host ""
Write-Host "证书信息:" -ForegroundColor Cyan
Write-Host "  主题：$($cert.Subject)"
Write-Host "  指纹：$($cert.Thumbprint)"
Write-Host "  有效期：$($cert.NotAfter) 到期"
Write-Host ""

# 导出证书
$certPath = Join-Path $PSScriptRoot "deepbot-cert.pfx"
Write-Host "正在导出证书到：$certPath" -ForegroundColor Yellow

$password = ConvertTo-SecureString -String "DeepBot2024" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $password

Write-Host "✅ 证书已导出（密码：DeepBot2024）" -ForegroundColor Green
Write-Host ""

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "重要提示：" -ForegroundColor Red
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. 手动导入证书到受信任的根证书颁发机构："
Write-Host "   - 按 Win+R，输入 certmgr.msc"
Write-Host "   - 展开 '受信任的根证书颁发机构'"
Write-Host "   - 右键 '证书' -> '所有任务' -> '导入'"
Write-Host "   - 选择 deepbot-cert.pfx，密码：DeepBot2024"
Write-Host ""
Write-Host "2. 打包时会自动使用此证书进行签名"
Write-Host ""
Write-Host "证书指纹（Thumbprint）: $($cert.Thumbprint)" -ForegroundColor Yellow
Write-Host ""
