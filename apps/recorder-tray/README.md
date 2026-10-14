# Tahi Recorder, Windows client handoff

The C# client is a separate REC.0 phase 2 run. This dashboard change adds no
capture implementation or executable. The approved source of truth is revision
1 of the REC.0 tray spec; Decision #072 records the fixed product choices.

The planned client is a .NET 8 WinForms tray application targeting
`net8.0-windows10.0.17763.0`. After its project lands, build a local Windows x64
self-contained executable from this directory:

```powershell
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
```

Distribution is local and manual initially. Auto-update, code signing and macOS
are follow-ups. The executable will be unsigned and may trigger SmartScreen or
Defender. The Next build, TypeScript, ESLint and Vitest exclude this directory;
all nested bin and obj outputs are ignored.

The server handoff and API contract are in
`../../docs/recorder-tray-server-handoff.md`. Apply migration 0114 before deploying
the dashboard server code. Never commit a pairing code, bearer token or secret.
