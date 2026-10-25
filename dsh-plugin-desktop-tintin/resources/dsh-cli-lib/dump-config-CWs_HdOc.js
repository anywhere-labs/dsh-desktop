import { a as prepareProfile, n as PROFILE_ROOT_FILENAME, r as homePatchPath } from "./profile-boot-C14i-8IN.js";
import { loadOptionalPatches, loadOverlayPatches, renderConfigDump } from "@deepseek-ai/dsh-app-boot";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
//#region lib/types/dump-config.js
/**
* Config-dump entry for `dsh --profile <name> --dump-config`: compose the
* profile's patch layers through the include plugin's patch algorithm without
* booting or evaluating `!!js`, with one source layer per bundle, the
* profile's own patch file, and each `--patch` overlay.
* @module @deepseek-ai/dsh/dump-config
*/
const NAME = "dsh";
/* v8 ignore start -- built-bin acceptance drives this boot-free dispatch */
/**
* Print a profile composition with comments naming each source file and patch layer.
* @param profile - the profile name.
* @param defaultOnly - omit the profile's user layer and `--patch` overlays
* (the recovery diagnostic for a broken `cordis.patch.yml`, which is then
* never parsed).
* @param patches - `--patch` overlay paths, in argv order.
* @param fromDefaultProfile - shipped template that replaces the profile before loading it.
*/
function runDumpConfig(profile, defaultOnly, patches, fromDefaultProfile) {
	const loaded = prepareProfile(profile, !defaultOnly, fromDefaultProfile);
	const layers = collectConfigDumpLayers(loaded, defaultOnly, patches);
	process.stdout.write(renderConfigDump(NAME, join(loaded.dir, PROFILE_ROOT_FILENAME), layers));
}
/**
* Read dump layers in bundle, profile, home, then argv order without composing them.
* @param loaded - prepared profile and parsed bundle and profile patches.
* @param defaultOnly - omit profile, home, and argv layers without reading their files.
* @param patches - overlay paths relative to the invoking directory, in argv order.
* @returns the labeled layers shared by YAML and schema dumps.
*/
function collectConfigDumpLayers(loaded, defaultOnly, patches) {
	const layers = loaded.layers.map((layer) => ({
		label: layer.packageName,
		patches: layer.patches
	}));
	if (!defaultOnly) {
		if (existsSync(loaded.patchPath)) layers.push({
			label: loaded.patchPath,
			patches: loaded.patches
		});
		const homePatchFile = homePatchPath();
		const homePatches = loadOptionalPatches(NAME, homePatchFile);
		if (homePatches !== void 0) layers.push({
			label: homePatchFile,
			patches: homePatches
		});
		for (const file of patches) {
			const absolute = resolve(file);
			layers.push({
				label: absolute,
				patches: loadOverlayPatches(NAME, absolute)
			});
		}
	}
	return layers;
}
/* v8 ignore stop */
//#endregion
export { runDumpConfig as n, collectConfigDumpLayers as t };
