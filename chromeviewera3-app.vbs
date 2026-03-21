Option Explicit

Dim shell
Dim fso
Dim root
Dim powerShellPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = """" & powerShellPath & """ -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\chromeviewera3-app.ps1"""

shell.Run command, 0, False
