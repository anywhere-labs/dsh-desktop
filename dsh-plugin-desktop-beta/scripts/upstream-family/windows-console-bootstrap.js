/**
* DSH Desktop: an Electron host owns no console, and a restricted child that
* must create its own dies with 0xC0000142 on some systems (#991, #1538).
* Give it one to inherit, without a window that Windows Terminal could show
* (#1268), as Stable's trampoline does: AllocConsoleWithOptions on Windows 11
* 24H2+, else the console of a hidden cmd.exe, else a hidden AllocConsole.
*/
async function ensureConsoleHost() {
	if (process.platform !== "win32") return;
	const koffi = createRequire(import.meta.url)("koffi");
	const kernel32 = koffi.load("kernel32.dll");
	if (kernel32.func("uint32 __stdcall GetConsoleCP()")() !== 0) return;
	if (allocWindowlessConsole(koffi, kernel32)) return;
	if (await attachDonorConsole(kernel32.func("int __stdcall AttachConsole(uint32)"))) return;
	if (kernel32.func("int __stdcall AllocConsole()")() === 0) fail(`AllocConsole failed (Win32 ${kernel32.func("uint32 __stdcall GetLastError()")()})`);
	const consoleWindow = kernel32.func("void * __stdcall GetConsoleWindow()")();
	if (consoleWindow !== null) koffi.load("user32.dll").func("int __stdcall ShowWindow(void *, int)")(consoleWindow, 0);
}
function allocWindowlessConsole(koffi, kernel32) {
	let allocate;
	try {
		const options = koffi.pointer(koffi.struct({
			mode: "int",
			useShowWindow: "int",
			showWindow: "uint16"
		}));
		allocate = kernel32.func("AllocConsoleWithOptions", "int32", [options, koffi.out(koffi.pointer("int"))]);
	} catch {
		return false;
	}
	const result = [0];
	return allocate({
		mode: 2,
		useShowWindow: 0,
		showWindow: 0
	}, result) >= 0 && result[0] !== 0;
}
function attachDonorConsole(attachConsole) {
	return new Promise((resolve) => {
		const donor = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), [
			"/d",
			"/q",
			"/k",
			"echo ready"
		], {
			stdio: [
				"pipe",
				"pipe",
				"ignore"
			],
			windowsHide: true
		});
		let output = "";
		let settled = false;
		const finish = (attached) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			donor.stdout.destroy();
			donor.stdin.end();
			if (!attached) donor.kill();
			resolve(attached);
		};
		const timer = setTimeout(() => finish(false), 1e4);
		donor.on("error", () => finish(false));
		donor.stdin.on("error", () => {});
		donor.once("exit", () => finish(false));
		donor.stdout.setEncoding("utf8");
		donor.stdout.on("data", (chunk) => {
			output += chunk;
			if (output.includes("ready") && donor.pid !== void 0) finish(attachConsole(donor.pid) !== 0);
		});
	});
}
