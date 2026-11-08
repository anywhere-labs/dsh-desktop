"""Regenerate the Route A provider-visibility Yarn patches.

Reads the two pinned vendored runtime tarballs directly from ``vendor/`` and
writes ``patches/dsh-<pkg>@<version>.patch`` for both channels. Run after an
upstream runtime bump so the patches keep applying to the new ``lib/index.js``:

    python scripts/gen_provider_visibility_patches.py

The replacements are exact-string based and each anchor must match exactly
once; a changed upstream layout fails loudly instead of producing a broken
patch. No temporary directories or external ``diff`` binary are needed.
"""
import difflib
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSIONS = ('0.2.1-rc.3', '0.2.2-rc.1')

PI_AI_OLD = 'const Config = z.object({ providers: z.dict(profile).default({}).volatile() });'
PI_AI_NEW = '''// Desktop: persisted provider-group visibility. Only the ids a user hid are
// stored; an unlisted provider id stays enabled. Kept at the top level so the
// profile dictionary's keys remain exclusively provider routes.
const Config = z.object({
\tproviders: z.dict(profile).default({}).volatile(),
\tdisabledProviders: z.array(z.string()).default([]).volatile()
});'''

SC_OLD = '\tconst providers = ctx.llm.listProviders();'
SC_NEW = '''\t// Desktop: hide provider groups the user turned off in Settings > Models.
\t// The list lives in the llm-pi-ai settings namespace (one variant-neutral
\t// location that also applies to the DeepSeek official group). Plugin-managed
\t// groups have no configurable-provider entry and are never listed here.
\tconst disabledProviders = (() => {
\t\tconst settings = ctx.get("settings");
\t\tif (settings === void 0) return new Set();
\t\ttry {
\t\t\tconst namespaces = settings.describe({ redactSecrets: true });
\t\t\tconst ns = namespaces.find((entry) => entry.ns === "llm-pi-ai");
\t\t\tconst value = ns?.value;
\t\t\tconst raw = value !== null && typeof value === "object" ? Reflect.get(value, "disabledProviders") : void 0;
\t\t\treturn new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
\t\t} catch {
\t\t\treturn new Set();
\t\t}
\t})();
\tconst providers = ctx.llm.listProviders().filter((provider) => !disabledProviders.has(provider.id));'''

TAIL_OLD = '''\tconst groups = catalog.flatMap((item) => item.kind === "group" ? [item.group] : []).filter((group) => group.models.length > 0);
\treturn {
\t\tdefault: { ...defaultSelection },
\t\troutableProviders: groups.map((group) => group.id),
\t\tgroups,
\t\tfailures: catalog.flatMap((item) => item.kind === "failure" ? [item.failure] : [])
\t};'''
TAIL_NEW = '''\tconst groups = catalog.flatMap((item) => item.kind === "group" ? [item.group] : []).filter((group) => group.models.length > 0 && !disabledProviders.has(group.id));
\tconst failures = catalog.flatMap((item) => item.kind === "failure" ? [item.failure] : []).filter((failure) => !disabledProviders.has(failure.id));
\treturn {
\t\tdefault: { ...defaultSelection },
\t\troutableProviders: groups.map((group) => group.id),
\t\tgroups,
\t\tfailures
\t};'''

TARGETS = {
    'dsh-llm-pi-ai': [(PI_AI_OLD, PI_AI_NEW)],
    'dsh-api-session-controller': [(SC_OLD, SC_NEW), (TAIL_OLD, TAIL_NEW)],
}


def read_member(tarball: Path, member: str) -> str:
    with tarfile.open(tarball, 'r:gz') as archive:
        handle = archive.extractfile(member)
        if handle is None:
            raise RuntimeError(f'{member} missing from {tarball}')
        return handle.read().decode('utf-8')


def main() -> None:
    patch_dir = ROOT / 'patches'
    patch_dir.mkdir(exist_ok=True)
    for version in VERSIONS:
        for pkg, replacements in TARGETS.items():
            tarball = ROOT / 'vendor' / 'dsh-runtime' / version / f'deepseek-ai-{pkg}-{version}.tgz'
            original = read_member(tarball, 'package/lib/index.js')
            modified = original
            for old, new in replacements:
                count = modified.count(old)
                if count != 1:
                    raise SystemExit(f'{version}/{pkg}: expected exactly 1 match for {old[:60]!r}, got {count}')
                modified = modified.replace(old, new)
            diff = list(difflib.unified_diff(
                original.splitlines(keepends=True),
                modified.splitlines(keepends=True),
                fromfile='a/lib/index.js', tofile='b/lib/index.js', n=3,
            ))
            body = ''.join(diff[2:])
            patch = f'diff --git a/lib/index.js b/lib/index.js\n{body}'
            out = patch_dir / f'{pkg}@{version}.patch'
            out.write_text(patch, encoding='utf-8', newline='\n')
            print(f'wrote {out.relative_to(ROOT)} ({len(diff) - 2} diff lines)')


if __name__ == '__main__':
    main()
