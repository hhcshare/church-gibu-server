[CmdletBinding()]
param(
    [string]$ProjectId = "church-gibu-server",
    [string]$DatabaseId = "(default)",
    [string]$OutputPath = (Join-Path $PSScriptRoot ("exports\donationApplications-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"))),
    [string]$GcloudPath = "gcloud"
)

$ErrorActionPreference = "Stop"

$null = Get-Command $GcloudPath -ErrorAction Stop
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $outputFile) {
    throw "Output already exists. Choose a new OutputPath."
}

$token = & $GcloudPath auth print-access-token "--project=$ProjectId" --quiet
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($token -join ""))) {
    throw "Google Cloud authentication failed. Run gcloud auth login first."
}

$headers = @{ Authorization = "Bearer $(($token -join '').Trim())" }
$project = [System.Uri]::EscapeDataString($ProjectId)
$database = [System.Uri]::EscapeDataString($DatabaseId)
$baseUri = "https://firestore.googleapis.com/v1/projects/$project/databases/$database/documents/donationApplications?pageSize=1000"
$documents = New-Object 'System.Collections.Generic.List[object]'
$pageToken = ""

do {
    $uri = $baseUri
    if (-not [string]::IsNullOrEmpty($pageToken)) {
        $uri += "&pageToken=$([System.Uri]::EscapeDataString($pageToken))"
    }

    $page = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 120
    foreach ($document in $page.documents) {
        if ($null -ne $document) {
            $documents.Add($document)
        }
    }
    $pageToken = $page.nextPageToken
} while (-not [string]::IsNullOrEmpty($pageToken))

$export = [ordered]@{
    projectId = $ProjectId
    databaseId = $DatabaseId
    collectionId = "donationApplications"
    exportedAt = [DateTime]::UtcNow.ToString("o")
    documentCount = $documents.Count
    documents = $documents.ToArray()
}
$json = $export | ConvertTo-Json -Depth 100
$directory = [System.IO.Path]::GetDirectoryName($outputFile)
$null = [System.IO.Directory]::CreateDirectory($directory)
$temporaryFile = Join-Path $directory ([System.IO.Path]::GetRandomFileName())

try {
    [System.IO.File]::WriteAllText($temporaryFile, $json, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::Move($temporaryFile, $outputFile)
} finally {
    if (Test-Path -LiteralPath $temporaryFile) {
        Remove-Item -LiteralPath $temporaryFile
    }
}

Write-Output ("Exported {0} documents to {1}" -f $documents.Count, $outputFile)
