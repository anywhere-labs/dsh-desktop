import { a as prepareProfile, t as INSTALL_ANCHOR } from "./profile-boot-C14i-8IN.js";
import { t as collectConfigDumpLayers } from "./dump-config-CWs_HdOc.js";
import { generateConfigSchema } from "@deepseek-ai/dsh-app-boot";
//#region lib/types/dump-config-schema.js
/**
* Schema-dump entry: inspect the composed profile without applying its plugins.
* Imports and lazy schema builders execute trusted module code.
* @module @deepseek-ai/dsh/dump-config-schema
*/
/* v8 ignore file -- built-bin acceptance drives schema collection and output. */
const NAME = "dsh";
/**
* Print one JSON Schema document; incomplete collection or projection sets exitCode to 1.
* Profile initialization writes match the YAML dump. Plugin imports may execute
* top-level code, but collection never applies plugins or evaluates `!!js`.
* During schema generation, ordinary stdout writes are redirected to stderr.
* @param profile - the profile name.
* @param patches - overlay paths, in argv order.
* @param fromDefaultProfile - shipped template that replaces the profile before loading it.
* @returns after collection and output, with diagnostics also written to stderr.
*/
async function runDumpConfigSchema(profile, patches, fromDefaultProfile) {
	const loaded = prepareProfile(profile, true, fromDefaultProfile);
	const layers = collectConfigDumpLayers(loaded, false, patches);
	const stdoutWrite = process.stdout.write;
	let dump;
	process.stdout.write = process.stderr.write.bind(process.stderr);
	try {
		dump = await generateConfigSchema(loaded, layers.map((layer) => layer.patches), INSTALL_ANCHOR);
	} finally {
		process.stdout.write = stdoutWrite;
	}
	process.stdout.write(`${JSON.stringify(dump, null, 2)}\n`);
	for (const diagnostic of dump["x-cordis"].diagnostics) {
		const location = diagnostic.path === void 0 ? "" : ` [${diagnostic.path}]`;
		process.stderr.write(`${NAME}: ${diagnostic.level}:${location} ${diagnostic.message}\n`);
	}
	if (!dump["x-cordis"].complete) process.exitCode = 1;
}
//#endregion
export { runDumpConfigSchema };
