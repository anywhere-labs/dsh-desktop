import { PROFILE_PATCH_FILENAME, PROFILE_TEMPLATES, PluginPackages, boot, createRuntimeResolution, initProfile, installFailLoud, loadOverlayPatches, loadProfile, readProfilePatches, reportSkippedBundles, resolveProfileDir } from "@deepseek-ai/dsh-app-boot";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installProxyFromEnvironment } from "@deepseek-ai/dsh-http-proxy";
import { DSH_LAUNCH_ENVIRONMENT_KEY } from "@deepseek-ai/dsh-launch-environment";
import { provideCmdline } from "@deepseek-ai/dsh-cmdline";
//#region lib/types/process-shutdown.js
/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */
/** Maximum grace allowed for the application tree to dispose before process exit. */
const PROCESS_SHUTDOWN_TIMEOUT_MS = 5e3;
/**
* Create one process-exit controller around an application disposer.
* @param dispose - Whole-application teardown that resolves at quiescence.
* @param forceExit - Function that exits the process immediately, replaceable by tests.
* @param complete - Function that records the natural completion code, replaceable by tests.
* @param timeoutMs - Grace before forced exit, replaceable by tests.
* @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
*/
function createProcessShutdown(dispose, forceExit = (code) => {
	process.exit(code);
}, complete = (code) => {
	process.exitCode = code;
}, timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS) {
	let pending;
	let timeout;
	let completed = false;
	let forceExited = false;
	const clearExitTimeout = () => {
		/* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
		if (timeout !== void 0) clearTimeout(timeout);
	};
	const forceExitOnce = (code) => {
		if (forceExited) return;
		forceExited = true;
		clearExitTimeout();
		forceExit(code);
	};
	const completeOnce = (code) => {
		if (completed || forceExited) return;
		completed = true;
		clearExitTimeout();
		complete(code);
	};
	const start = (code, forceAfterDispose) => {
		if (pending !== void 0) return pending;
		timeout = setTimeout(() => {
			forceExitOnce(code);
		}, timeoutMs);
		pending = Promise.resolve().then(dispose).then(() => {
			if (forceAfterDispose) forceExitOnce(code);
			else completeOnce(code);
		}, () => {
			forceExitOnce(code);
		});
		return pending;
	};
	return {
		shutdown(code) {
			return start(code, false);
		},
		interrupt(code) {
			if (pending !== void 0) {
				forceExitOnce(code);
				return;
			}
			start(code, true);
		}
	};
}
//#endregion
//#region lib/types/profile-boot.js
/**
* Shared profile boot for every `dsh` surface: resolve the profile, stack its
* patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
* own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
* tree over the profile's empty root config, and wire fail-loud plus bounded shutdown.
*
* App flags are not the launcher's business: the invocation's inner arguments
* are provided to the tree through `ctx.cmdlineArgs`, where any injected app
* plugin may read the same immutable snapshot.
* @module @deepseek-ai/dsh/profile-boot
*/
const NAME = "dsh";
/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady() {
	let ready = false;
	const listeners = /* @__PURE__ */ new Set();
	return {
		service: { onReady(listener) {
			if (ready) {
				listener();
				return () => {};
			}
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		} },
		commit() {
			if (ready) return;
			ready = true;
			for (const listener of [...listeners]) listener();
			listeners.clear();
		}
	};
}
/**
* The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
* over every profile's own layer. Resolved per call, not at module load:
* `$DSH_HOME` may be set by the test or launcher after import.
* @returns the absolute patch-file path.
*/
function homePatchPath() {
	return join(resolveDshHome(), PROFILE_PATCH_FILENAME);
}
/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
const INSTALL_ANCHOR = fileURLToPath(new URL("../package.json", import.meta.url));
/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`;
/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = "cordis.yml";
/**
* Replace the named custom profile with a fresh copy of one shipped template.
* This copies only the template's bundle list; local state from the
* same-named shipped profile is not read, and no inheritance metadata is
* persisted. The new profile is assembled in a `.<name>.staging-*` directory
* under the profiles directory and moved into place; only then is any previous
* target directory, including its dependencies and user patch, deleted. A
* failed move restores the previous directory; when restoring also fails, it
* stays in the staging directory. Shipped profile names, compared without
* case, are reserved. Concurrent replacements leave one complete copy; each
* one either succeeds or reports the concurrent recreation.
* @param name - the profile name to create or replace.
* @param fromDefaultProfile - shipped profile template to copy.
* @param home - Harness home containing the profile directory.
* @throws when the template is unknown, the target name is shipped, another process recreates the target
*   between the two renames, or a file-system operation fails; a restore failure is an `AggregateError`
*   that names the staging path holding the previous profile.
*/
function initializeProfileFromDefault(name, fromDefaultProfile, home = resolveDshHome()) {
	const dir = resolveProfileDir(name, home);
	const template = Object.hasOwn(PROFILE_TEMPLATES, fromDefaultProfile) ? PROFILE_TEMPLATES[fromDefaultProfile] : void 0;
	if (template === void 0) {
		const expected = Object.keys(PROFILE_TEMPLATES).sort().map((value) => JSON.stringify(value)).join(", ");
		throw new Error(`${NAME}: unknown default profile ${JSON.stringify(fromDefaultProfile)}; expected one of ${expected}`);
	}
	const shipped = Object.keys(PROFILE_TEMPLATES).find((shippedName) => shippedName.toLowerCase() === name.toLowerCase());
	if (shipped !== void 0) throw new Error(`${NAME}: profile ${JSON.stringify(name)} names shipped profile ${JSON.stringify(shipped)} and cannot be a custom profile target; omit --from-default-profile to use it`);
	mkdirSync(dirname(dir), { recursive: true });
	const staging = mkdtempSync(join(dirname(dir), `.${name}.staging-`));
	const previous = join(staging, "previous");
	try {
		const fresh = join(staging, "new", name);
		initProfile(fresh, template.bundles);
		let moved = false;
		try {
			renameSync(dir, previous);
			moved = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		try {
			renameSync(fresh, dir);
		} catch (error) {
			if (existsSync(dir)) {
				rmSync(previous, {
					recursive: true,
					force: true
				});
				throw new Error(`${NAME}: profile ${JSON.stringify(name)} was recreated concurrently at ${dir}`, { cause: error });
			}
			if (moved) try {
				renameSync(previous, dir);
			} catch (restoreError) {
				throw new AggregateError([error, restoreError], `${NAME}: profile replacement failed and ${dir} could not be restored from ${previous}`);
			}
			throw error;
		}
	} catch (error) {
		if (!existsSync(previous)) rmSync(staging, {
			recursive: true,
			force: true
		});
		throw error;
	}
	try {
		rmSync(staging, {
			recursive: true,
			force: true
		});
	} catch (error) {
		process.stderr.write(`${NAME}: replaced profile ${JSON.stringify(name)} but could not remove ${staging}: ${String(error)}\n`);
	}
}
/**
* Load a resolved profile for `name` and (re)write the empty root config. The
* root is always rewritten: the whole composition is patch layers, and the
* vendored Loader's tree write-back (a plugin self-disposing persists the
* current tree) can bake composed rows into this file — which would duplicate
* every bundle insert on the next boot. The file exists on disk only because
* the Loader needs a real include root to anchor `baseUrl` at the profile
* directory (the config dump anchors on the same file, so both compose over
* the identical base).
* @param name - the profile name.
* @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
* @param fromDefaultProfile - shipped template that replaces the profile before loading it.
* @returns the loaded profile.
* @throws when explicit initialization names an unknown template or a shipped target.
*/
function prepareProfile(name, userLayer = true, fromDefaultProfile) {
	if (fromDefaultProfile !== void 0) initializeProfileFromDefault(name, fromDefaultProfile);
	const profile = loadProfile(NAME, name, INSTALL_ANCHOR, void 0, { userLayer });
	reportSkippedBundles(NAME, profile);
	writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
	return profile;
}
/**
* Load `name` and compose its effective patch stack: bundle layers in
* `dsh.profile.bundles` order (a base-backed profile gets the base bundle's
* platform-gated shell rows), the profile's user layer, the home-level user
* layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
* to every profile, so it outranks the per-profile layer), `--patch` overlays,
* then the telemetry switch.
* @param name - the profile name.
* @param patchFiles - `--patch` overlay paths, in argv order.
* @param fromDefaultProfile - shipped template that replaces the named profile.
* @param resolvedProfile - application-owned profile and installation.
* @returns the profile and its patch layers.
*/
async function composeProfile(name, patchFiles, fromDefaultProfile, resolvedProfile) {
	const profile = resolvedProfile?.profile ?? prepareProfile(name, true, fromDefaultProfile);
	if (resolvedProfile !== void 0) writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG);
	return {
		profile,
		resolution: await createRuntimeResolution({
			installAnchor: resolvedProfile?.installAnchor ?? INSTALL_ANCHOR,
			profile
		}),
		overlays: patchFiles.flatMap((file) => loadOverlayPatches(NAME, resolve(file)))
	};
}
/**
* Boot one profile invocation end to end and leave process lifetime to the
* mounted plugins (or to a one-shot runner the composition mounts).
* @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
* @returns the settled root context and the shutdown controller.
* @throws after disposing startup resources; cleanup failures retain the original error.
*/
async function runProfile(options) {
	const disposeProxy = await installProxyFromEnvironment(options.environment, (message) => {
		process.stderr.write(`${NAME}: ${message}\n`);
	});
	const app = {};
	let disposal;
	const dispose = () => disposal ??= (async () => {
		const failures = [];
		for (const release of [() => app.current?.fiber.dispose(), disposeProxy]) try {
			await release();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "dsh: profile cleanup failed");
	})();
	try {
		const composed = await composeProfile(options.profile, options.patchFiles, options.fromDefaultProfile, options.resolvedProfile);
		const appReady = createAppReady();
		const shutdown = createProcessShutdown(dispose);
		const signalShutdown = new AbortController();
		const interrupt = (code) => {
			signalShutdown.abort();
			shutdown.interrupt(code);
		};
		process.on("SIGTERM", () => {
			interrupt(0);
		});
		process.on("SIGINT", () => {
			interrupt(130);
		});
		installFailLoud(NAME, process, async () => {
			await app.current?.fiber.dispose();
		});
		const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME);
		const profileContext = {
			name: options.profile,
			...options.packageManager === void 0 ? {} : { packageManager: options.packageManager },
			dir: composed.profile.dir,
			patchPath: composed.profile.patchPath,
			installAnchor: options.resolvedProfile?.installAnchor ?? INSTALL_ANCHOR,
			startedBundles: composed.profile.layers.map((layer) => layer.packageName),
			cwd: process.cwd(),
			home: resolveDshHome(),
			overlays: composed.overlays,
			telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED
		};
		const ctx = await boot(NAME, rootConfig, readProfilePatches(NAME, profileContext, composed.profile), async (hostCtx) => {
			app.current = hostCtx;
			hostCtx.provide("profileContext", profileContext);
			hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);
			await hostCtx.plugin(PluginPackages, { resolution: composed.resolution });
			provideCmdline(hostCtx, {
				args: options.args,
				exit: (code) => void shutdown.shutdown(code),
				ready: appReady.service
			});
		});
		app.current = ctx;
		if (!signalShutdown.signal.aborted && ctx.fiber.state === 2 && ctx.get("loader") !== void 0) appReady.commit();
		return {
			ctx,
			shutdown
		};
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "dsh: profile startup and cleanup failed");
		}
		throw error;
	}
}
//#endregion
export { prepareProfile as a, initializeProfileFromDefault as i, PROFILE_ROOT_FILENAME as n, runProfile as o, homePatchPath as r, INSTALL_ANCHOR as t };
