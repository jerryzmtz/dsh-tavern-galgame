param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $TestDirectory){throw 'Use a new test directory'}
New-Item -ItemType Directory $TestDirectory | Out-Null
# Substitute only the registry read in the compiled test copy; execute the real selection flow.
$source=Get-Content (Join-Path $PSScriptRoot 'Launcher.cs') -Raw
$source=$source.Replace('using(var key=Registry.CurrentUser.OpenSubKey(@"Software\DSH-Tavern"))return key==null?null:key.GetValue("InstallRoot") as string;', 'return Environment.GetEnvironmentVariable("REINSTALL_FIXTURE");')
[IO.File]::WriteAllText((Join-Path $TestDirectory 'Launcher.cs'),$source)
@"
using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
class ReinstallTest {
 [STAThread] static int Main() {
  string folder=Path.GetDirectoryName(Application.ExecutablePath);
  Environment.SetEnvironmentVariable("DSH_LAUNCHER_TEST_ROOT",null);
  Environment.SetEnvironmentVariable("REINSTALL_FIXTURE",Path.Combine(folder,"deleted-install"));
  try {
   Check(folder,false); Check(folder,true); Check(folder,true,true);
   Console.WriteLine("PASS: missing registered directory supports cancellation, explicit reinstall and restoring original data");return 0;
  }catch(Exception e){Console.WriteLine("FAIL: "+e.GetBaseException().Message);return 1;}
 }
 static void Check(string folder,bool install,bool restore=false) {
  string old=Path.Combine(folder,"restored-install"),data=Path.Combine(folder,"saved-data");
  if(restore){Directory.CreateDirectory(old);Directory.CreateDirectory(data);new System.Xml.Linq.XDocument(new System.Xml.Linq.XElement("Installation",new System.Xml.Linq.XElement("DataDirectory",data))).Save(Path.Combine(old,"launcher-settings.xml"));}
  bool sawRecovery=false,sawSetup=false;
  using(var launcher=(Form)Activator.CreateInstance(typeof(Launcher),BindingFlags.Instance|BindingFlags.NonPublic,null,new object[]{new string[0]},null))
  using(var timer=new Timer{Interval=50}) {
   int ticks=0;
   timer.Tick+=delegate {
    if(++ticks>100)throw new Exception("Selection dialog timed out");
    if(Application.OpenForms.Count==0)return;
    Form dialog=Application.OpenForms[Application.OpenForms.Count-1];
    if(dialog.GetType().Name=="MissingInstallationDialog") {
     sawRecovery=true;
     if(restore)foreach(Control c in dialog.Controls)if(c is TextBox)c.Text=old;
     foreach(Control c in dialog.Controls)if(c is Button && c.Text==(restore?"使用原目录":install?"重新安装":"取消")){((Button)c).PerformClick();break;}
    }else if(dialog is SetupDialog) {
     sawSetup=true;
     foreach(Control c in dialog.Controls)if(c is TextBox && !restore)c.Text=Path.Combine(folder,"new-install");
     foreach(Control c in dialog.Controls)if(c is Button && c.Text==(restore?"修复并启动":"安装并启动")){((Button)c).PerformClick();break;}
    }
   };
   timer.Start();
   bool result=(bool)typeof(Launcher).GetMethod("SelectInstallation",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(launcher,null);
   timer.Stop();
   if(restore && (string)typeof(Launcher).GetField("data",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(launcher)!=data)throw new Exception("Restored data path changed");
   if(!sawRecovery || result!=install || sawSetup!=install)throw new Exception("Missing installation did not offer expected recovery flow");
   if(Directory.Exists(Path.Combine(folder,"deleted-install")))throw new Exception("Old directory was recreated");
  }
 }
}
"@ | Set-Content (Join-Path $TestDirectory 'Harness.cs') -Encoding UTF8
$exe=Join-Path $TestDirectory 'test.exe'
$savedTemp=$env:TEMP; $savedTmp=$env:TMP
try {
$env:TEMP=$TestDirectory; $env:TMP=$TestDirectory
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /main:ReinstallTest /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Xml.Linq.dll "/out:$exe" (Join-Path $TestDirectory 'Launcher.cs') (Join-Path $PSScriptRoot 'SetupDialog.cs') (Join-Path $TestDirectory 'Harness.cs')
if($LASTEXITCODE -ne 0){throw 'Compilation failed'}
& $exe
if($LASTEXITCODE -ne 0){throw 'Reinstall regression failed'}

} finally { $env:TEMP=$savedTemp; $env:TMP=$savedTmp }
