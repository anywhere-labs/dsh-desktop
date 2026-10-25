#!/usr/bin/env node
import { StartupError, getDshRuntimeVersion, loadLayeredEnv } from "@deepseek-ai/dsh-app-boot";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
//#region lib/types/args.js
/**
* Commander adapter for the `dsh` command line.
*
* The launcher parses only what it owns — which profile to boot, which extra
* patch overlays to apply, and the config dumps — and hands **everything after
* its own flags** to the booted tree verbatim, where injected app plugins parse
* their own flag families and print their own `--help` (see
* `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
* token this parser does not recognize starts the inner arguments, so
* `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
* and `dsh --profile web -h` prints the web app's help, not this one's.
*
* `dsh <name>` abbreviates `dsh --profile <name>`; `plugin` manages a profile's
* plugin dependencies by forwarding to pnpm.
* @module @deepseek-ai/dsh/args
*/
/**
* Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
* variadic — a variadic `--patch` would swallow the inner arguments.
*/
const collect = (value, previous = []) => [...previous, value];
function selectProfile(value, previous) {
	if (previous !== void 0) throw new InvalidArgumentError("select a profile only once");
	return value;
}
function rejectElectronProfile(program, profile) {
	if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
}
/** The launcher's own help text; each app prints its own. */
const HELP_EXAMPLES = `
Examples:
  dsh web                                   boot the web profile (same as: dsh --profile web)
  dsh rescue --from-default-profile web
                                            recreate rescue from the shipped web template, then boot it
  dsh headless "run the tests"              answer one task, print the result, and exit
  dsh tui --patch ./extra.yml               boot a custom profile with one extra overlay
  dsh tui --resume <session>                arguments after the launcher flags reach the app
  dsh web --help                            the web app's own flags and help
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
`;
/**
* Resolve a boot or dump invocation from the launcher flags and the leftover
* inner arguments.
* @param program - the command whose options were parsed.
* @param profile - the profile these flags boot.
* @param options - the launcher flags commander collected.
* @param args - the leftover arguments, in argv order.
* @returns the resolved invocation.
*/
function resolveBoot(program, profile, options, args) {
	const patches = options.patch ?? [];
	if (patches.includes("")) program.error("error: --patch needs a path");
	if (options.fromDefaultProfile === "") program.error("error: --from-default-profile needs a name");
	const dumps = [
		options.dumpConfig,
		options.dumpDefaultConfig,
		options.dumpConfigSchema
	].filter(Boolean);
	if (dumps.length === 0) return {
		mode: "profile",
		profile,
		fromDefaultProfile: options.fromDefaultProfile,
		patches,
		args
	};
	if (dumps.length > 1) program.error("error: --dump-config, --dump-default-config, and --dump-config-schema are mutually exclusive");
	if (args.length > 0) program.error(`error: config dumps take no app arguments, got ${args.map((argument) => JSON.stringify(argument)).join(" ")}`);
	if (options.dumpConfigSchema === true) return {
		mode: "dump-config-schema",
		profile,
		fromDefaultProfile: options.fromDefaultProfile,
		patches
	};
	const defaultOnly = options.dumpDefaultConfig === true;
	if (defaultOnly && patches.length > 0) program.error("error: --dump-default-config prints the bundle layers and takes no --patch");
	return {
		mode: "dump-config",
		profile,
		fromDefaultProfile: options.fromDefaultProfile,
		defaultOnly,
		patches
	};
}
/**
* Resolve argv into one invocation, or print and exit for help, version, or an
* error.
* @param argv - arguments after the Node binary and script.
* @param version - version string printed by `--version`.
* @param manageDesktopProfile - permit Desktop's installed carrier to manage its reserved profile's plugins.
* @returns the resolved invocation.
*/
function parseDshArgs(argv, version, manageDesktopProfile = false) {
	const first = argv[0];
	let resolved;
	const program = new Command();
	program.name("dsh").version(version, "-V, --version", "output the version number").usage("[--profile] <name> [options] [app-args...]\n       dsh plugin --profile <name> <pnpm-args...>").description("dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.").addHelpText("after", HELP_EXAMPLES).exitOverride().helpOption(false).helpCommand(false).allowUnknownOption().passThroughOptions().enablePositionalOptions().argument("[args...]", "arguments for the booted profile's app (see: dsh --profile <name> --help)").option("--profile <name>", "the profile under $DSH_HOME/profiles to boot", selectProfile).option("--from-default-profile <name>", "replace a custom profile with a fresh copy of a shipped profile template").option("--patch <path>", "extra patch-list overlay applied after the profile layer (repeatable)", collect).option("--dump-config", "print the composed profile tree and exit").option("--dump-config-schema", "print JSON Schema for profile entries and patches without mounting").option("--dump-default-config", "print the profile tree without its user layer or --patch overlays and exit").action((args, options) => {
		if (options.profile === void 0) {
			if (args.some((argument) => argument === "-h" || argument === "--help")) program.help();
			program.error("error: --profile <name> is required");
		}
		const profile = options.profile;
		if (profile === "") program.error("error: --profile needs a name");
		rejectElectronProfile(program, profile);
		resolved = resolveBoot(program, profile, options, args);
	});
	if (first === "plugin") {
		const plugin = program.command("plugin").description("manage a profile's plugins by forwarding the remaining arguments to pnpm in the profile directory");
		plugin.helpOption("-h, --help", "show this help").passThroughOptions().requiredOption("--profile <name>", "the profile whose plugins to manage (initialized on first use)", selectProfile).allowUnknownOption().argument("[args...]", "pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)").action((args, options) => {
			if (options.profile === "") program.error("error: --profile needs a name");
			if (!manageDesktopProfile) rejectElectronProfile(plugin, options.profile);
			if (args.length === 0) program.error("error: plugin needs pnpm arguments to forward (e.g. add <package>)");
			resolved = {
				mode: "plugin",
				profile: options.profile.toLowerCase() === "desktop" ? "desktop" : options.profile,
				args
			};
		});
	}
	try {
		const expanded = first !== void 0 && !first.startsWith("-") && first !== "plugin" ? ["--profile", ...argv] : argv;
		program.parse(expanded, { from: "user" });
	} catch (error) {
		return process.exit(error instanceof CommanderError ? error.exitCode : 1);
	}
	/* v8 ignore next -- an action resolves or Commander throws */
	if (resolved === void 0) throw new Error("dsh: no invocation resolved");
	return resolved;
}
//#endregion
//#region lib/types/startup-diagnostics.js
/** Save original startup diagnostics while keeping the terminal report concise. */
/** Wait for stderr to finish the write before the failed process exits. */
function writeStderr(text) {
	return new Promise((resolve, reject) => {
		process.stderr.write(text, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
/**
* Print the startup summary and save a private, uniquely named report under DSH_HOME/logs.
* Failed writes print the complete report to stderr instead of claiming a saved path.
* @param error - startup audit failure retaining plugin metadata and original errors.
* @param context - resolved Harness home, application version, and selected profile.
* @param write - terminal output sink; awaited before returning, defaults to stderr.
* @returns after saving or printing the report and completing terminal writes.
*/
async function reportStartupFailure(error, context, write = writeStderr) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const report = "WARNING: Raw diagnostics may contain configuration or credential values from plugin errors. Review before sharing.\n\n" + inspect({
		timestamp: now,
		dshVersion: context.version,
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
		profile: context.profile,
		error
	}, {
		depth: null,
		maxArrayLength: null,
		maxStringLength: null,
		showHidden: true,
		customInspect: false,
		getters: false,
		colors: false
	}) + "\n";
	await write(`${error.message}\n`);
	const logDir = join(context.home, "logs");
	const logPath = join(logDir, `startup-${now.replaceAll(":", "-")}-${randomUUID()}.log`);
	try {
		await mkdir(logDir, {
			recursive: true,
			mode: 448
		});
		await writeFile(logPath, report, {
			flag: "wx",
			mode: 384
		});
	} catch (writeError) {
		await write(`\ndsh: warning: could not write startup diagnostics: ${String(writeError)}\nFull diagnostics:\n${report}`);
		return;
	}
	await write(`\nFull diagnostics: ${logPath}\n`);
}
//#endregion
//#region lib/types/bin.js
/**
* Command-line entry for dsh.
* @module @deepseek-ai/dsh/bin
*/
/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */
/**
* Run the public dsh command-line interface.
* @param options - Package runtime and Desktop profile access supplied by the installation.
* @returns a promise that settles when the selected command mode finishes.
*/
async function runCli(options = {}) {
	const version = getDshRuntimeVersion();
	const { manageDesktopProfile, ...profileOptions } = options;
	const invocation = parseDshArgs(process.argv.slice(2), version, manageDesktopProfile);
	switch (invocation.mode) {
		case "profile": {
			const { runProfile } = await import("./profile-boot.js");
			try {
				await runProfile({
					environment: loadLayeredEnv("dsh"),
					profile: invocation.profile,
					fromDefaultProfile: invocation.fromDefaultProfile,
					patchFiles: invocation.patches,
					args: invocation.args,
					...profileOptions
				});
			} catch (error) {
				if (!(error instanceof StartupError)) throw error;
				await reportStartupFailure(error, {
					home: resolveDshHome(),
					version,
					profile: invocation.profile
				});
				process.exit(1);
			}
			break;
		}
		case "plugin": {
			const { runPlugin } = await import("./plugin-BiveYA7h.js");
			process.exit(await runPlugin(invocation.profile, invocation.args, options.packageManager));
			break;
		}
		case "dump-config": {
			const { runDumpConfig } = await import("./dump-config-CxNkSYcK.js");
			runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches, invocation.fromDefaultProfile);
			break;
		}
		case "dump-config-schema": {
			const { runDumpConfigSchema } = await import("./dump-config-schema-D_PxIzpe.js");
			await runDumpConfigSchema(invocation.profile, invocation.patches, invocation.fromDefaultProfile);
			break;
		}
		default: throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`);
	}
}
if (import.meta.main) await runCli();
//#endregion
export { runCli };
