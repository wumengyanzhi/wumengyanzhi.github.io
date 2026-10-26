import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Refuse to connect to a player-owned browser, even if a debugging port is present. */
export function verifyQaBrowser(port = 9458) {
  if (process.platform !== 'win32') throw Error('This local QA profile check requires Windows.');
  const command = String.raw`$ErrorActionPreference='Stop'; $taskQaListener=Get-NetTCPConnection -LocalPort ([int]$env:FIVE_ARRAYS_QA_PORT) -State Listen | Select-Object -First 1; $taskQaProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskQaListener.OwningProcess); if (-not $taskQaProcess.CommandLine.Contains($env:FIVE_ARRAYS_QA_PROFILE) -or -not $taskQaProcess.CommandLine.Contains('--headless=new')) { throw 'Wrong browser profile; no storage writes permitted.' }; Write-Output 'QA_ISOLATED';`;
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    env: { ...process.env, FIVE_ARRAYS_QA_PORT: String(port), FIVE_ARRAYS_QA_PROFILE: resolve('.cache/command-battle-chrome') },
    windowsHide: true,
  });
  if (!result.includes('QA_ISOLATED')) throw Error('Isolated browser could not be verified.');
}
