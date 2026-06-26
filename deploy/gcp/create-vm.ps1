param(
    [string]$ProjectId = "YOUR_GCP_PROJECT_ID",
    [string]$Zone = "us-central1-a",
    [string]$VmName = "aipsite-dev",
    [string]$MachineType = "e2-medium",
    [string]$BootDiskSize = "30GB",
    [string]$ImageFamily = "ubuntu-2404-lts-amd64",
    [string]$ImageProject = "ubuntu-os-cloud",
    [string]$NetworkTag = "aipsite-web",
    [string]$RepoUrl = "https://github.com/NYGsatoshi/AIPsiteNYG.git",
    [switch]$RunBootstrap,
    [switch]$RunDeploy
)

$ErrorActionPreference = "Stop"

if ($ProjectId -eq "YOUR_GCP_PROJECT_ID") {
    throw "Set -ProjectId to your GCP project ID."
}

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & gcloud @Args
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud command failed: gcloud $($Args -join ' ')"
    }
}

Write-Host "Using project $ProjectId in zone $Zone"
Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable compute.googleapis.com

$existingVm = & gcloud compute instances describe $VmName --zone $Zone --format "value(name)" 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingVm)) {
    Write-Host "Creating VM $VmName..."
    Invoke-Gcloud compute instances create $VmName `
        --zone $Zone `
        --machine-type $MachineType `
        --boot-disk-size $BootDiskSize `
        --image-family $ImageFamily `
        --image-project $ImageProject `
        --tags $NetworkTag
} else {
    Write-Host "VM $VmName already exists; skipping create."
}

$firewallName = "$VmName-http-8080"
$existingFirewall = & gcloud compute firewall-rules describe $firewallName --format "value(name)" 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingFirewall)) {
    Write-Host "Creating firewall rule $firewallName for tcp:80,8080..."
    Invoke-Gcloud compute firewall-rules create $firewallName `
        --allow tcp:80,tcp:8080 `
        --target-tags $NetworkTag `
        --description "Allow HTTP access to AIPsite development VM"
} else {
    Write-Host "Firewall rule $firewallName already exists; skipping create."
}

Write-Host "Copying GCP helper scripts to VM home directory..."
Invoke-Gcloud compute ssh $VmName --zone $Zone --command "mkdir -p ~/aipsite-gcp"
Invoke-Gcloud compute scp --recurse ".\deploy\gcp" "${VmName}:~/aipsite-gcp" --zone $Zone
Invoke-Gcloud compute ssh $VmName --zone $Zone --command "chmod +x ~/aipsite-gcp/gcp/*.sh"

if ($RunBootstrap) {
    Write-Host "Running bootstrap-vm.sh on VM..."
    Invoke-Gcloud compute ssh $VmName --zone $Zone --command "bash ~/aipsite-gcp/gcp/bootstrap-vm.sh"
}

if ($RunDeploy) {
    Write-Host "Running deploy-app.sh on VM..."
    Invoke-Gcloud compute ssh $VmName --zone $Zone --command "REPO_URL='$RepoUrl' bash ~/aipsite-gcp/gcp/deploy-app.sh"
}

$externalIp = & gcloud compute instances describe $VmName --zone $Zone --format "value(networkInterfaces[0].accessConfigs[0].natIP)"

Write-Host ""
Write-Host "VM is ready."
Write-Host "SSH:"
Write-Host "  gcloud compute ssh $VmName --zone $Zone"
Write-Host ""
Write-Host "On the VM:"
Write-Host "  bash ~/aipsite-gcp/gcp/bootstrap-vm.sh"
Write-Host "  REPO_URL='$RepoUrl' bash ~/aipsite-gcp/gcp/deploy-app.sh"
Write-Host ""
Write-Host "Access URL after deploy:"
Write-Host "  http://$externalIp`:8080"
Write-Host "  http://$externalIp"
