using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using TahiRecorder.App.Security;

namespace TahiRecorder.App.Integration;

internal static class StartMenuShortcut
{
    internal static void Create(string executable, string appId, Guid activator)
    {
        WindowsInstallSecurity.RequireSafe();
        var directory = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        Directory.CreateDirectory(directory);
        var shortcut = Path.Combine(directory, "Tahi Recorder.lnk");
        var instance = new ShellLink();
        try
        {
            var link = (IShellLinkW)instance;
            link.SetPath(executable);
            link.SetWorkingDirectory(Path.GetDirectoryName(executable)!);
            link.SetDescription("Tahi Recorder");
            link.SetIconLocation(executable, 0);
            var store = (IPropertyStore)instance;
            var identityKey = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
            var activatorKey = new PropertyKey(identityKey.FormatId, 26);
            var identityValue = PropVariant.String(appId);
            var activatorValue = PropVariant.ClassId(activator);
            try
            {
                store.SetValue(ref identityKey, ref identityValue);
                store.SetValue(ref activatorKey, ref activatorValue);
                store.Commit();
                ((IPersistFile)instance).Save(shortcut, true);
            }
            finally
            {
                PropVariantClear(ref identityValue);
                PropVariantClear(ref activatorValue);
            }
        }
        finally { Marshal.FinalReleaseComObject(instance); }
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr item);
        void SetIDList(IntPtr item);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey(Guid formatId, uint propertyId)
    {
        internal Guid FormatId = formatId;
        internal uint PropertyId = propertyId;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] private ushort _type;
        [FieldOffset(8)] private IntPtr _value;
        internal static PropVariant String(string value) => new() { _type = 31, _value = Marshal.StringToCoTaskMemUni(value) };
        internal static PropVariant ClassId(Guid value)
        {
            var memory = Marshal.AllocCoTaskMem(Marshal.SizeOf<Guid>());
            Marshal.StructureToPtr(value, memory, false);
            return new PropVariant { _type = 72, _value = memory };
        }
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }
    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);
}
