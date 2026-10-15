using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace TahiRecorder.App.Capture;

internal sealed record ObservedProcess(int Id, int ParentId, string Name);

internal static class ProcessTree
{
    private const uint SnapshotProcesses = 0x00000002;

    public static IReadOnlyDictionary<int, ObservedProcess> Snapshot()
    {
        using var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot.IsInvalid)
            throw new Win32Exception(Marshal.GetLastWin32Error());

        var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>() };
        var result = new Dictionary<int, ObservedProcess>();
        if (!Process32First(snapshot, ref entry))
            return result;

        do
        {
            var id = checked((int)entry.ProcessId);
            result[id] = new ObservedProcess(id, checked((int)entry.ParentProcessId),
                Path.GetFileNameWithoutExtension(entry.ExeFile).ToLowerInvariant());
            entry.Size = (uint)Marshal.SizeOf<ProcessEntry>();
        } while (Process32Next(snapshot, ref entry));

        return result;
    }

    public static string? MeetingPlatform(int processId, IReadOnlyDictionary<int, ObservedProcess> processes)
    {
        string? browser = null;
        var visited = new HashSet<int>();
        for (var depth = 0; depth < 64 && processId > 0 && visited.Add(processId); depth++)
        {
            if (processId == Environment.ProcessId)
                return null;
            if (!processes.TryGetValue(processId, out var process))
                break;
            switch (process.Name)
            {
                case "ms-teams":
                case "teams":
                    return "teams";
                case "zoom":
                    return "zoom";
                case "chrome":
                case "msedge":
                case "vivaldi":
                case "firefox":
                    browser = "meet";
                    break;
            }
            processId = process.ParentId;
        }
        return browser;
    }

    public static (int RootId, IReadOnlyCollection<int> ProcessIds) ResolveMeetingTree(
        int processId, string platform, IReadOnlyDictionary<int, ObservedProcess> processes)
    {
        var root = processId;
        var visited = new HashSet<int>();
        for (var current = processId; current > 0 && visited.Add(current)
            && processes.TryGetValue(current, out var process); current = process.ParentId)
        {
            var matches = platform switch
            {
                "zoom" => process.Name == "zoom",
                "teams" => process.Name is "teams" or "ms-teams",
                "meet" => process.Name is "chrome" or "msedge" or "vivaldi" or "firefox",
                _ => false
            };
            if (matches)
                root = current;
        }
        var ids = new HashSet<int> { root, processId };
        var added = true;
        while (added)
        {
            added = false;
            foreach (var process in processes.Values)
                if (process.Id != Environment.ProcessId && ids.Contains(process.ParentId) && ids.Add(process.Id))
                    added = true;
        }
        return (root, ids.ToArray());
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(SafeFileHandle snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(SafeFileHandle snapshot, ref ProcessEntry entry);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public nint DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int PriorityClassBase;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExeFile;
    }
}
