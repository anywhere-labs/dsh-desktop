/**
 * Schema-dump entry: inspect the composed profile without applying its plugins.
 * Imports and lazy schema builders execute trusted module code.
 * @module @deepseek-ai/dsh/dump-config-schema
 */
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
export declare function runDumpConfigSchema(profile: string, patches: readonly string[], fromDefaultProfile?: string): Promise<void>;
//# sourceMappingURL=dump-config-schema.d.ts.map