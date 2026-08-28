# Windows sampler for the RDR2 results-screen detector. RESEARCH ONLY.
#
# Captures the RDR2 WINDOW (never the desktop), reduces each frame to a fixed
# greyscale grid inside this process, and writes one NDJSON line per sample to
# stdout. The frame itself is disposed immediately and is never written to disk
# unless -DebugDir was passed explicitly.
#
# Emits, per sample:
#   {"ok":true,"grid":[...],"w":<int>,"h":<int>,"captureMs":<num>}
#   {"ok":false,"reason":"<why this sample was refused>"}
#
# FAILS CLOSED. Every condition that could produce a misleading grid — no
# window, more than one candidate window, a minimised window, a zero-sized
# rect, a PrintWindow that returned nothing — emits ok:false with a reason
# instead of a grid. A refused sample can never become the negative that bounds
# the boundary, which is the property that keeps an uncertain run uncertain.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [double]$CropX = 0.15,
  [double]$CropY = 0.08,
  [double]$CropW = 0.70,
  [double]$CropH = 0.18,
  [int]$GridWidth = 320,
  [int]$GridHeight = 80,
  [double]$Hz = 2.0,
  [int]$MaxSamples = 0,
  # Explicit, local-only, and refused by the caller if it points inside a
  # research bundle. Writes cropped PNGs plus a privacy notice.
  [string]$DebugDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SpecsmithWin {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  // Visible, non-owned top-level windows belonging to one process. Owned
  // windows (GW_OWNER != 0) are dialogs and tooltips, not the game surface, so
  // they are excluded rather than counted as ambiguity.
  public static System.Collections.Generic.List<IntPtr> VisibleTopLevelWindowsFor(int targetPid) {
    var found = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if ((int)owner != targetPid) return true;
      if (!IsWindowVisible(hwnd)) return true;
      if (GetWindow(hwnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
      RECT r;
      if (!GetClientRect(hwnd, out r)) return true;
      if ((r.Right - r.Left) < 64 || (r.Bottom - r.Top) < 64) return true;
      found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

function Write-Sample([hashtable]$obj) {
  # Compress so one sample is one line; the caller parses NDJSON.
  [Console]::Out.WriteLine((ConvertTo-Json $obj -Compress -Depth 3))
  [Console]::Out.Flush()
}

if ($DebugDir -ne '') {
  if (-not (Test-Path -LiteralPath $DebugDir)) { New-Item -ItemType Directory -Path $DebugDir -Force | Out-Null }
  $notice = Join-Path $DebugDir 'PRIVACY-README.txt'
  if (-not (Test-Path -LiteralPath $notice)) {
    @'
PRIVACY: LOCAL SCREENSHOTS OF YOUR GAME WINDOW

This directory holds cropped frames captured from the RDR2 window while a
research detector ran. They were written ONLY because a debug-image option was
passed explicitly.

- They are LOCAL. Nothing here is uploaded, and nothing here is part of any
  research bundle, observation, or benchmark submission.
- They are NOT needed after a run. Delete this directory when you are done.
- Do not copy these into a research bundle. The tooling refuses to write them
  there, and that refusal exists for a reason.

Without the debug-image option no frame is ever written to disk.
'@ | Set-Content -LiteralPath $notice -Encoding UTF8
  }
}

# Resolve exactly one candidate window for the PID. Ambiguity is refused rather
# than resolved by picking the first, because capturing the wrong window would
# produce a confident answer about something that is not the game.
#
# This ENUMERATES top-level windows rather than reading MainWindowHandle. An
# earlier version used Get-Process, which yields one process object carrying one
# MainWindowHandle — so the "more than one candidate" branch below could never
# be reached, and the ambiguity guard this script documents was dead code.
# A game with a splash window still up, or a second instance, is exactly the
# case that must be refused, so the check has to be able to see it.
function Resolve-GameWindow([int]$TargetPid) {
  if ($null -eq (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) {
    return @{ ok = $false; reason = "no process with pid $TargetPid" }
  }
  $handles = [SpecsmithWin]::VisibleTopLevelWindowsFor($TargetPid)
  if ($handles.Count -eq 0) { return @{ ok = $false; reason = "pid $TargetPid has no visible top-level window (it may be minimised to tray, or not yet showing)" } }
  if ($handles.Count -gt 1) { return @{ ok = $false; reason = "pid $TargetPid exposes $($handles.Count) visible top-level windows; refusing rather than guessing which is the game" } }
  return @{ ok = $true; hwnd = $handles[0] }
}

$intervalMs = [int](1000.0 / $Hz)
$count = 0

while ($true) {
  $started = [System.Diagnostics.Stopwatch]::StartNew()
  $bmp = $null
  $gfx = $null
  try {
    $win = Resolve-GameWindow -TargetPid $TargetProcessId
    if (-not $win.ok) { Write-Sample @{ ok = $false; reason = $win.reason }; }
    else {
      $hwnd = $win.hwnd
      if ([SpecsmithWin]::IsIconic($hwnd)) { Write-Sample @{ ok = $false; reason = 'window is minimised' } }
      elseif (-not [SpecsmithWin]::IsWindowVisible($hwnd)) { Write-Sample @{ ok = $false; reason = 'window is not visible' } }
      else {
        $rect = New-Object SpecsmithWin+RECT
        if (-not [SpecsmithWin]::GetClientRect($hwnd, [ref]$rect)) { Write-Sample @{ ok = $false; reason = 'GetClientRect failed' } }
        else {
          $w = $rect.Right - $rect.Left
          $h = $rect.Bottom - $rect.Top
          if ($w -lt 64 -or $h -lt 64) { Write-Sample @{ ok = $false; reason = "client rect is ${w}x${h}, too small to be the game" } }
          else {
            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $gfx = [System.Drawing.Graphics]::FromImage($bmp)
            $hdc = $gfx.GetHdc()
            # PW_RENDERFULLCONTENT (0x2): renders the window's own content, so a
            # partially occluded window still captures correctly and the desktop
            # is never read. DX exclusive fullscreen can return black here; that
            # is detected below and refused rather than reported as a negative.
            $printed = [SpecsmithWin]::PrintWindow($hwnd, $hdc, 0x2)
            $gfx.ReleaseHdc($hdc)
            if (-not $printed) { Write-Sample @{ ok = $false; reason = 'PrintWindow failed (the window may be in exclusive fullscreen)' } }
            else {
              $cx = [int]([Math]::Floor($CropX * $w)); $cy = [int]([Math]::Floor($CropY * $h))
              $cw = [Math]::Max(1, [int]([Math]::Floor($CropW * $w))); $ch = [Math]::Max(1, [int]([Math]::Floor($CropH * $h)))
              if (($cx + $cw) -gt $w -or ($cy + $ch) -gt $h) { Write-Sample @{ ok = $false; reason = 'crop falls outside the client rect' } }
              else {
                # Box-filter the crop straight down to the grid. Done with a
                # single DrawImage into a small bitmap so no full-size copy of
                # the frame is ever materialised beyond the one capture.
                $small = New-Object System.Drawing.Bitmap($GridWidth, $GridHeight)
                $sg = [System.Drawing.Graphics]::FromImage($small)
                $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $srcRect = New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)
                $dstRect = New-Object System.Drawing.Rectangle(0, 0, $GridWidth, $GridHeight)
                $sg.DrawImage($bmp, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
                $sg.Dispose()

                $grid = New-Object 'System.Collections.Generic.List[int]'
                for ($y = 0; $y -lt $GridHeight; $y++) {
                  for ($x = 0; $x -lt $GridWidth; $x++) {
                    $p = $small.GetPixel($x, $y)
                    # Rec. 601 luma.
                    $grid.Add([int](0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B))
                  }
                }

                if ($DebugDir -ne '') {
                  $crop = New-Object System.Drawing.Bitmap($cw, $ch)
                  $cg = [System.Drawing.Graphics]::FromImage($crop)
                  $cg.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $cw, $ch)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
                  $cg.Dispose()
                  $crop.Save((Join-Path $DebugDir ("LOCAL-ONLY-crop-{0:D5}.png" -f $count)), [System.Drawing.Imaging.ImageFormat]::Png)
                  $crop.Dispose()
                }
                $small.Dispose()

                $started.Stop()
                Write-Sample @{ ok = $true; grid = $grid.ToArray(); w = $w; h = $h; captureMs = $started.Elapsed.TotalMilliseconds }
              }
            }
          }
        }
      }
    }
  } catch {
    Write-Sample @{ ok = $false; reason = "sampler error: $($_.Exception.Message)" }
  } finally {
    # The frame lives no longer than the sample that used it.
    if ($null -ne $gfx) { $gfx.Dispose() }
    if ($null -ne $bmp) { $bmp.Dispose() }
  }

  $count++
  if ($MaxSamples -gt 0 -and $count -ge $MaxSamples) { break }
  $elapsed = $started.Elapsed.TotalMilliseconds
  $sleep = [int]([Math]::Max(0, $intervalMs - $elapsed))
  if ($sleep -gt 0) { Start-Sleep -Milliseconds $sleep }
}
