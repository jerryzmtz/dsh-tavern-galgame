using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// A suspended child cannot allocate or spawn before it belongs to the job.
public static class TavernTestJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct CompletionPort { public IntPtr Key, Port; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr Process, Thread;
        public uint Pid, Tid;
    }
    public sealed class Result {
        public uint code, pid;
        public string reason;
        public ulong peakJobBytes;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref CompletionPort info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ExtendedLimits info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, IntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out IntPtr key, out IntPtr value, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    public static Result Run(string app, string command, string cwd, ulong bytes, uint timeoutMs, uint parentPid) {
        IntPtr job = IntPtr.Zero, port = IntPtr.Zero, parent = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        bool assigned = false;
        try {
            parent = OpenProcess(0x100000, false, parentPid);
            Check(parent != IntPtr.Zero);
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits();
            // Commit limits cover ArrayBuffers/native memory too; descendants share the budget.
            limits.Basic.Flags = 0x2000 | 0x100 | 0x200; // KILL_ON_CLOSE, PROCESS_MEMORY, JOB_MEMORY
            limits.ProcessMemory = limits.JobMemory = new UIntPtr(bytes);
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)));
            port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, IntPtr.Zero, 1);
            Check(port != IntPtr.Zero);
            var completion = new CompletionPort { Key = new IntPtr(1), Port = port };
            Check(SetInformationJobObject(job, 7, ref completion, (uint)Marshal.SizeOf(completion)));
            var startup = new StartupInfo();
            startup.Size = (uint)Marshal.SizeOf(startup);
            startup.Flags = 0x100; // STARTF_USESTDHANDLES
            startup.Input = GetStdHandle(-10); startup.Output = GetStdHandle(-11); startup.Error = GetStdHandle(-12);
            Check(CreateProcess(app, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
                0x4 | 0x08000000, IntPtr.Zero, cwd, ref startup, out child));
            Check(AssignProcessToJobObject(job, child.Process));
            assigned = true;
            Check(ResumeThread(child.Thread) != uint.MaxValue);
            var clock = Stopwatch.StartNew();
            var result = new Result { pid = child.Pid, reason = "exit" };
            while (true) {
                uint message; IntPtr key, value;
                // Kernel rejects over-budget commits even if notification delivery is delayed.
                while (GetQueuedCompletionStatus(port, out message, out key, out value, 0)) {
                    if (message == 9 || message == 10) { result.reason = "memory"; result.code = 125; }
                }
                if (result.reason == "memory") break;
                if (WaitForSingleObject(child.Process, 0) == 0) {
                    Check(GetExitCodeProcess(child.Process, out result.code));
                    break;
                }
                if (WaitForSingleObject(parent, 0) == 0) { result.reason = "parent-exit"; result.code = 126; break; }
                if (clock.ElapsedMilliseconds >= timeoutMs) { result.reason = "timeout"; result.code = 124; break; }
                System.Threading.Thread.Sleep(10);
            }
            // Also remove descendants on normal exit; no WMI/taskkill process is needed.
            Check(TerminateJobObject(job, result.code));
            WaitForSingleObject(child.Process, 5000);
            Check(QueryInformationJobObject(job, 9, out limits, (uint)Marshal.SizeOf(limits), IntPtr.Zero));
            result.peakJobBytes = limits.PeakJobMemory.ToUInt64();
            return result;
        } finally {
            // Setup failures fail closed, including failure to assign a suspended child.
            if (child.Process != IntPtr.Zero && !assigned) TerminateProcess(child.Process, 127);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            if (port != IntPtr.Zero) CloseHandle(port);
            if (parent != IntPtr.Zero) CloseHandle(parent);
        }
    }
}
