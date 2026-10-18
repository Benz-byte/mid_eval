param([Parameter(Mandatory=$true)][string]$DocumentPath, [Parameter(Mandatory=$true)][string]$PdfPath)
$ErrorActionPreference = 'Stop'
$DocumentPath = (Resolve-Path -LiteralPath $DocumentPath).ProviderPath
$PdfPath = [System.IO.Path]::GetFullPath($PdfPath).Replace('/', '\')
$taskWord = $null
$taskDocument = $null
try {
    $taskWord = New-Object -ComObject Word.Application
    $taskWord.Visible = $false
    $taskWord.DisplayAlerts = 0
    $taskConfirmConversions = $false
    $taskReadOnly = $true
    $taskAddToRecent = $false
    $taskDocument = $taskWord.Documents.Open([ref]$DocumentPath, [ref]$taskConfirmConversions, [ref]$taskReadOnly, [ref]$taskAddToRecent)
    $taskDocument.Repaginate()
    $taskStatistic = 2
    $taskPages = $taskDocument.ComputeStatistics([ref]$taskStatistic)
    $taskDocument.ExportAsFixedFormat($PdfPath, 17)
    Write-Output "Rendered $taskPages pages to $PdfPath"
} finally {
    $taskNoSave = 0
    try {
        if ($null -ne $taskDocument) { $taskDocument.Close([ref]$taskNoSave); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskDocument) }
    } finally {
        if ($null -ne $taskWord) { $taskWord.Quit([ref]$taskNoSave); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskWord) }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
