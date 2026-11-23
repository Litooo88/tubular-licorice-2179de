# Kör lokalt som ägare efter publicering. Behåll befintliga klienter och scopes.
$ErrorActionPreference = 'Stop'
$endpoint = 'https://www.nordicemobility.se/api/ai/config'
$metadata = Invoke-RestMethod 'https://www.nordicemobility.se/api/ai/.well-known'
$additional = @('journal:read','journal:append','customer:name')
foreach ($scope in $additional) {
    if ($scope -notin $metadata.scopes.PSObject.Properties.Name) { throw "Publicera gatewayändringen först: $scope saknas." }
}
$credential = Get-Credential -UserName NEMOB -Message 'Ange verkstadens adminnyckel som lösenord lokalt.'
try {
    $headers = @{ 'x-admin-token' = $credential.GetNetworkCredential().Password }
    $config = Invoke-RestMethod $endpoint -Headers $headers -MaximumRedirection 0
    if (!$config.oauthReady) { throw 'OAuth är inte redo. Kontrollera ägar-PIN och signeringsnyckel i gatewayens ägarkonfiguration.' }
    if ($config.source -eq 'env') { throw 'Miljökonfiguration har företräde. Lägg till dessa scopes i AI_GATEWAY_OAUTH_SCOPES hos Netlify.' }
    $scopes = @(@($config.oauthScopes) + $additional | Sort-Object -Unique)
    $null = Invoke-RestMethod $endpoint -Method Post -Headers $headers -MaximumRedirection 0 -ContentType 'application/json' -Body (@{ oauthScopes = $scopes } | ConvertTo-Json)
    Write-Output 'Behörigheterna är tillagda i samtyckeslistan. Anslut nu i ChatGPT.'
} finally {
    Remove-Variable headers,credential -ErrorAction SilentlyContinue
}
