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
        if (!security.AreAccessRulesProtected) return false;
        var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
        var expected = new[] { currentUser, SystemSid, AdministratorsSid }.Distinct().ToArray();
        return rules.Length == expected.Length && rules.All(rule =>
            !rule.IsInherited &&
            expected.Contains((SecurityIdentifier)rule.IdentityReference) &&
            rule.AccessControlType == AccessControlType.Allow && rule.FileSystemRights == FileSystemRights.FullControl &&
            rule.InheritanceFlags == Children && rule.PropagationFlags == PropagationFlags.None) &&
            expected.All(sid => rules.Count(rule => rule.IdentityReference.Equals(sid)) == 1);
    }

    public static bool CanReprotectRoot(DirectorySecurity security, SecurityIdentifier currentUser)
    {
        if (!currentUser.Equals(security.GetOwner(typeof(SecurityIdentifier)))) return false;
        var descriptor = new RawSecurityDescriptor(security.GetSecurityDescriptorBinaryForm(), 0);
        if (descriptor.DiscretionaryAcl is null) return false;
        var trusted = new[] { currentUser, SystemSid, AdministratorsSid };
        return security.GetAccessRules(true, false, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>()
            .All(rule => trusted.Contains((SecurityIdentifier)rule.IdentityReference));
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
            var security = root.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access);
            if (!IsTrustedRoot(security, currentUser))
            {
                if (!CanReprotectRoot(security, currentUser))
                    throw new UnauthorizedAccessException(RootRecoveryMessage(root.FullName));
                root.SetAccessControl(BuildRootAcl(currentUser));
            }
        }
        else root.Create(BuildRootAcl(currentUser));

        if (!IsTrustedRoot(root.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), currentUser))
            throw new UnauthorizedAccessException(RootRecoveryMessage(root.FullName));
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
                if (NeedsDescendantAclRepair(security))
                {
                    PrepareDescendantAcl(security);
                    directory.SetAccessControl(security);
                }
                InheritDescendants(directory);
            }
            else if (item is FileInfo file)
            {
                var security = file.GetAccessControl(AccessControlSections.Access);
                if (NeedsDescendantAclRepair(security))
                {
                    PrepareDescendantAcl(security);
                    file.SetAccessControl(security);
                }
            }
        }
    }

    public static bool NeedsDescendantAclRepair(FileSystemSecurity security) =>
        security.AreAccessRulesProtected ||
        security.GetAccessRules(true, false, typeof(SecurityIdentifier)).Count != 0;

    public static bool IsSafeInstallDirectory(string path, SecurityIdentifier currentUser)
    {
        var directory = new DirectoryInfo(path);
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0 ||
            !IsSafeInstallAcl(directory.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), currentUser))
            return false;
        foreach (var item in directory.EnumerateFileSystemInfos())
        {
            if ((item.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            if (item is DirectoryInfo child)
            {
                if (!IsSafeInstallDirectory(child.FullName, currentUser)) return false;
            }
            else if (item is FileInfo file &&
                !IsSafeInstallAcl(file.GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access), currentUser))
                return false;
        }
        return true;
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
            throw new UnauthorizedAccessException($"Recorder storage '{item.FullName}' must not contain links. Close Tahi Recorder and remove the link, preserving any recording data in its target first.");
    }

    private static string RootRecoveryMessage(string path) =>
        $"Recorder folder '{path}' has an unsafe owner or explicit permissions. Close Tahi Recorder and set its owner to your Windows account and remove explicit permissions for other users. Alternatively, back up retained recordings and delete this folder so Tahi Recorder can recreate it.";
}
