using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

namespace TahiRecorder.Core.Security;

/// <summary>The only principals permitted to read or change local recorder data.</summary>
[SupportedOSPlatform("windows")]
public static class RecorderDirectorySecurity
{
    private static readonly SecurityIdentifier SystemSid = new(WellKnownSidType.LocalSystemSid, null);
    private static readonly SecurityIdentifier AdministratorsSid = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private static readonly SecurityIdentifier TrustedInstallerSid =
        new("S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
    private static readonly SecurityIdentifier CreatorOwnerSid = new(WellKnownSidType.CreatorOwnerSid, null);
    private const InheritanceFlags Children = InheritanceFlags.ObjectInherit | InheritanceFlags.ContainerInherit;
    private const FileSystemRights WriteRights = FileSystemRights.Write | FileSystemRights.Delete |
        FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;

    public static DirectorySecurity BuildRootAcl(SecurityIdentifier currentUser)
    {
        var security = new DirectorySecurity();
        security.SetOwner(currentUser);
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { currentUser, SystemSid, AdministratorsSid }.Distinct())
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                Children, PropagationFlags.None, AccessControlType.Allow));
        return security;
    }

    // Validate before replacing the ACL, so a planted folder is never silently trusted.
    public static bool IsTrustedRoot(DirectorySecurity security, SecurityIdentifier currentUser)
    {
        if (!currentUser.Equals(security.GetOwner(typeof(SecurityIdentifier)))) return false;
        var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
        var expected = new[] { currentUser, SystemSid, AdministratorsSid }.Distinct().ToArray();
        return rules.Length == expected.Length && rules.All(rule =>
            expected.Contains((SecurityIdentifier)rule.IdentityReference) &&
            rule.AccessControlType == AccessControlType.Allow && rule.FileSystemRights == FileSystemRights.FullControl &&
            rule.InheritanceFlags == Children && rule.PropagationFlags == PropagationFlags.None) &&
            expected.All(sid => rules.Count(rule => rule.IdentityReference.Equals(sid)) == 1);
    }

    public static bool IsSafeInstallAcl(FileSystemSecurity security, SecurityIdentifier currentUser)
    {
        var trusted = new[] { currentUser, SystemSid, AdministratorsSid, TrustedInstallerSid };
        // Owners can rewrite a DACL even without a write ACE.
        if (security.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !trusted.Contains(owner))
            return false;
        var descriptor = new RawSecurityDescriptor(security.GetSecurityDescriptorBinaryForm(), 0);
        if (descriptor.DiscretionaryAcl is null) return false;
        foreach (var rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>())
        {
            if (rule.AccessControlType != AccessControlType.Allow) continue;
            // Program Files includes a child-only CREATOR OWNER template. It grants
            // no rights here; the executable's real owner/ACL are checked separately.
            if (rule.IdentityReference.Equals(CreatorOwnerSid) &&
                (rule.PropagationFlags & PropagationFlags.InheritOnly) != 0) continue;
            const uint genericAllOrWrite = 0x10000000 | 0x40000000;
            if (((uint)rule.FileSystemRights & ((uint)WriteRights | genericAllOrWrite)) != 0 &&
                !trusted.Contains((SecurityIdentifier)rule.IdentityReference)) return false;
        }
        return true;
    }

    public static void ProtectDataDirectory(string path, SecurityIdentifier currentUser)
    {
        var root = new DirectoryInfo(path);
        if (root.Exists)
        {
            RejectLink(root);
            if (!IsTrustedRoot(root.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), currentUser))
                throw new UnauthorizedAccessException("Recorder folder owner or permissions are unsafe.");
            root.SetAccessControl(BuildRootAcl(currentUser));
        }
        else root.Create(BuildRootAcl(currentUser));

        if (!IsTrustedRoot(root.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), currentUser))
            throw new UnauthorizedAccessException("Recorder folder permissions could not be protected.");
        foreach (var name in new[] { "outbox", "capture", "tokens", "logs" })
            Directory.CreateDirectory(Path.Combine(root.FullName, name));
        InheritDescendants(root);
    }

    private static void InheritDescendants(DirectoryInfo parent)
    {
        foreach (var item in parent.EnumerateFileSystemInfos())
        {
            RejectLink(item);
            if (item is DirectoryInfo directory)
            {
                var security = directory.GetAccessControl(AccessControlSections.Access);
                PrepareDescendantAcl(security);
                directory.SetAccessControl(security);
                InheritDescendants(directory);
            }
            else if (item is FileInfo file)
            {
                var security = file.GetAccessControl(AccessControlSections.Access);
                PrepareDescendantAcl(security);
                file.SetAccessControl(security);
            }
        }
    }

    public static void PrepareDescendantAcl(FileSystemSecurity security)
    {
        security.SetAccessRuleProtection(isProtected: false, preserveInheritance: false);
        foreach (var rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>())
            security.RemoveAccessRuleSpecific(rule);
    }

    private static void RejectLink(FileSystemInfo item)
    {
        if ((item.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new UnauthorizedAccessException("Recorder storage must not contain links.");
    }
}
