$ErrorActionPreference = "Stop"

$VendorDir = "assets\vendor"
if (!(Test-Path $VendorDir)) {
    New-Item -ItemType Directory -Force -Path $VendorDir
}

# Define files to download
$files = @(
    @{ url="https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js"; path="mammoth\mammoth.browser.min.js"; dir="mammoth" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js"; path="pdfmake\pdfmake.min.js"; dir="pdfmake" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js"; path="pdfmake\vfs_fonts.js"; dir="pdfmake" },
    @{ url="https://cdn.jsdelivr.net/npm/html-to-pdfmake@2.4.25/browser.js"; path="html-to-pdfmake\browser.js"; dir="html-to-pdfmake" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; path="html2canvas\html2canvas.min.js"; dir="html2canvas" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; path="jspdf\jspdf.umd.min.js"; dir="jspdf" },
    @{ url="https://unpkg.com/html-docx-js@0.3.1/dist/html-docx.js"; path="html-docx-js\html-docx.js"; dir="html-docx-js" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"; path="pdfjs\pdf.min.mjs"; dir="pdfjs" },
    @{ url="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs"; path="pdfjs\pdf.worker.min.mjs"; dir="pdfjs" },
    @{ url="https://cdn.jsdelivr.net/npm/marked@16.1.1/lib/marked.esm.js"; path="marked\marked.esm.js"; dir="marked" },
    @{ url="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.es.mjs"; path="dompurify\purify.es.mjs"; dir="dompurify" },
    @{ url="https://cdn.jsdelivr.net/npm/marked-katex-extension@5.1.2/lib/index.mjs"; path="marked-katex-extension\index.mjs"; dir="marked-katex-extension" },
    @{ url="https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/unhinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf"; path="fonts\NotoSansDevanagari-Regular.ttf"; dir="fonts" }
)

foreach ($file in $files) {
    $targetDir = Join-Path $VendorDir $file.dir
    if (!(Test-Path $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }
    
    $targetPath = Join-Path $VendorDir $file.path
    Write-Host "Downloading $($file.url) to $targetPath"
    Invoke-WebRequest -Uri $file.url -OutFile $targetPath
}

# Download and extract KaTeX
$katexZip = Join-Path $VendorDir "katex.zip"
$katexDir = Join-Path $VendorDir "katex"
Write-Host "Downloading KaTeX from https://github.com/KaTeX/KaTeX/releases/download/v0.16.11/katex.zip"
Invoke-WebRequest -Uri "https://github.com/KaTeX/KaTeX/releases/download/v0.16.11/katex.zip" -OutFile $katexZip
Expand-Archive -Path $katexZip -DestinationPath $VendorDir -Force
Remove-Item $katexZip -Force

Write-Host "Vendor assets downloaded successfully."
