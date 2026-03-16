@echo off
REM Generate_Music_Folders.bat
REM Creates a 'music' folder at the same level as this script and
REM adds the 10 category folders with an 'img' subfolder each.

REM Use the script directory as the root (create 'music' next to this file)
set "ROOT=%~dp0"
set "MUSIC=%ROOT%music"

if exist "%MUSIC%" (
  echo Music folder already exists at "%MUSIC%"
  goto :EOF
)

echo Music folder not found. Creating at "%MUSIC%"...

for %%A in (
  "Fifty Sixty"
  "Seventy"
  "Eighty"
  "Ninety"
  "2000"
  "Latest Hits"
  "Country"
  "Karaoke"
  "Special Occasion"
  "Christmas Song"
) do (
  md "%MUSIC%\%%~A\img" >nul 2>&1
  if exist "%MUSIC%\%%~A\img" (
    echo Created: "%MUSIC%\%%~A\img"
  ) else (
    echo Failed:  "%MUSIC%\%%~A\img"
  )
)

echo Done.
exit /b 0
