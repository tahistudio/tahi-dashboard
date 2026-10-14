using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using TahiRecorder.Core.Security;

namespace TahiRecorder.Core.Tests;

[SupportedOSPlatform("windows")]
public sealed class RecorderDirectorySecurityTests
{
    private static SecurityIdentifier User => new("S-1-5-21-100-200-300-1001");

    [Fact]
    public void RootAclHasOnlyUserSystemAndAdministratorsWithProtectedFullControl()
    {
        var acl = RecorderDirectorySecurity.BuildRootAcl(User);
        Assert.True(acl.AreAccessRulesProtected);
        Assert.Equal(User, acl.GetOwner(typeof(SecurityIdentifier)));
        var rules = acl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().ToArray();
        Assert.Equal(3, rules.Length);
        Assert.Equal(new[] { "S-1-5-18", "S-1-5-32-544", User.Value }.Order(),
            rules.Select(rule => rule.IdentityReference.Value).Order());
        Assert.All(rules, rule =>
        {
            Assert.Equal(FileSystemRights.FullControl, rule.FileSystemRights);
            Assert.Equal(InheritanceFlags.ObjectInherit | InheritanceFlags.ContainerInherit, rule.InheritanceFlags);
            Assert.Equal(PropagationFlags.None, rule.PropagationFlags);
            Assert.Equal(AccessControlType.Allow, rule.AccessControlType);
            Assert.False(rule.IsInherited);
        });
        Assert.True(RecorderDirectorySecurity.IsTrustedRoot(acl, User));
    }

    [Fact]
    public void RootRejectsWrongOwnerAndExtraAce()
    {
        var acl = RecorderDirectorySecurity.BuildRootAcl(User);
        acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        Assert.False(RecorderDirectorySecurity.IsTrustedRoot(acl, User));
        acl.SetOwner(User);
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            FileSystemRights.Read, AccessControlType.Allow));
        Assert.False(RecorderDirectorySecurity.IsTrustedRoot(acl, User));
    }

    [Fact]
    public void InstallRejectsBroadWriteButPermitsBroadRead()
    {
        var acl = RecorderDirectorySecurity.BuildRootAcl(User);
        var everyone = new SecurityIdentifier(WellKnownSidType.WorldSid, null);
        acl.AddAccessRule(new FileSystemAccessRule(everyone, FileSystemRights.ReadAndExecute, AccessControlType.Allow));
        Assert.True(RecorderDirectorySecurity.IsSafeInstallAcl(acl, User));
        acl.AddAccessRule(new FileSystemAccessRule(everyone, FileSystemRights.Write, AccessControlType.Allow));
        Assert.False(RecorderDirectorySecurity.IsSafeInstallAcl(acl, User));
    }

    [Fact]
    public void DescendantAclRemovesExplicitPermissionsAndEnablesParentInheritance()
    {
        var acl = RecorderDirectorySecurity.BuildRootAcl(User);
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid, null),
            FileSystemRights.Read, AccessControlType.Allow));
        RecorderDirectorySecurity.PrepareDescendantAcl(acl);
        Assert.False(acl.AreAccessRulesProtected);
        Assert.Empty(acl.GetAccessRules(true, false, typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>());
    }

    [Theory]
    [InlineData("GA")]
    [InlineData("GW")]
    public void InstallRejectsGenericWriteGrants(string rights)
    {
        var acl = new DirectorySecurity();
        acl.SetSecurityDescriptorSddlForm($"O:{User.Value}D:(A;OICI;{rights};;;WD)");
        Assert.False(RecorderDirectorySecurity.IsSafeInstallAcl(acl, User));
    }

    [Fact]
    public void ProgramFilesCreatorOwnerTemplateDoesNotMakeTrustedInstallUnsafe()
    {
        var acl = new DirectorySecurity();
        acl.SetSecurityDescriptorSddlForm($"O:{User.Value}D:(A;OICI;FA;;;{User.Value})(A;OICIIO;GA;;;CO)");
        Assert.True(RecorderDirectorySecurity.IsSafeInstallAcl(acl, User));
    }
}
